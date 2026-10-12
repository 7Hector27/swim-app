// There are no unit tests for the leave/remove transactions because the mocked
// db.transaction() does not enforce Postgres constraints. The unique index on
// household_members.profile_id (one household per person) is only enforced by
// a real database, so these integration tests are the authoritative guard for
// correct transaction ordering (delete old membership before inserting new one).
import { afterAll, afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import pino from "pino";
import { createApp } from "../../app";
import {
  adminDb,
  closeAdminDb,
  createTestUser,
  createTestUserInHousehold,
  type TestUser,
} from "./helpers";
import { householdMembers } from "../../db/schema";
import { and, eq } from "drizzle-orm";

const logger = pino({ level: "silent" });
const app = createApp(logger);

const testUsers: TestUser[] = [];

afterEach(async () => {
  for (const user of testUsers.splice(0)) {
    await user.cleanup().catch(() => { /* best-effort */ });
  }
});

afterAll(async () => {
  await closeAdminDb();
});

// ── PATCH /households/mine — rename ───────────────────────────────────────────

describe("PATCH /households/mine", () => {
  it("owner renames household → 200 and GET /mine reflects new name", async () => {
    const owner = await createTestUser("rename-owner");
    testUsers.push(owner);

    const res = await request(app)
      .patch("/households/mine")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ name: "Renamed Family" });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Renamed Family");

    const mine = await request(app)
      .get("/households/mine")
      .set("Authorization", `Bearer ${owner.accessToken}`);
    expect(mine.body.name).toBe("Renamed Family");
  });

  it("non-owner cannot rename → 403", async () => {
    const owner = await createTestUser("rename-nonowner-owner");
    testUsers.push(owner);
    const viewer = await createTestUserInHousehold("rename-nonowner-viewer", owner.householdId, "viewer");
    testUsers.push(viewer);

    const res = await request(app)
      .patch("/households/mine")
      .set("Authorization", `Bearer ${viewer.accessToken}`)
      .send({ name: "Hijacked Name" });

    expect(res.status).toBe(403);
  });

  it("name longer than 50 chars → 422", async () => {
    const owner = await createTestUser("rename-toolong");
    testUsers.push(owner);

    const res = await request(app)
      .patch("/households/mine")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ name: "x".repeat(51) });

    expect(res.status).toBe(422);
  });

  it("empty name → 422", async () => {
    const owner = await createTestUser("rename-empty");
    testUsers.push(owner);

    const res = await request(app)
      .patch("/households/mine")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ name: "" });

    expect(res.status).toBe(422);
  });
});

// ── PATCH /households/mine/members/:profileId — change role ───────────────────

describe("PATCH /households/mine/members/:profileId", () => {
  it("owner changes viewer to manager → 200", async () => {
    const owner = await createTestUser("role-owner");
    testUsers.push(owner);
    const viewer = await createTestUserInHousehold("role-viewer", owner.householdId, "viewer");
    testUsers.push(viewer);

    const res = await request(app)
      .patch(`/households/mine/members/${viewer.userId}`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ role: "manager" });

    expect(res.status).toBe(200);

    const rows = await adminDb()
      .select({ role: householdMembers.role })
      .from(householdMembers)
      .where(
        and(
          eq(householdMembers.householdId, owner.householdId),
          eq(householdMembers.profileId, viewer.userId),
        ),
      );
    expect(rows[0]?.role).toBe("manager");
  });

  it("owner self-change → 403 (self_role_change)", async () => {
    const owner = await createTestUser("role-self");
    testUsers.push(owner);

    const res = await request(app)
      .patch(`/households/mine/members/${owner.userId}`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ role: "viewer" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("self_role_change");
  });

  it("non-owner cannot change roles → 403", async () => {
    const owner = await createTestUser("role-nonowner-owner");
    testUsers.push(owner);
    const viewer = await createTestUserInHousehold("role-nonowner-viewer", owner.householdId, "viewer");
    testUsers.push(viewer);
    const other = await createTestUserInHousehold("role-nonowner-other", owner.householdId, "viewer");
    testUsers.push(other);

    const res = await request(app)
      .patch(`/households/mine/members/${other.userId}`)
      .set("Authorization", `Bearer ${viewer.accessToken}`)
      .send({ role: "manager" });

    expect(res.status).toBe(403);
  });

  it("non-member target → 404", async () => {
    const owner = await createTestUser("role-nonmember-owner");
    testUsers.push(owner);
    const outsider = await createTestUser("role-nonmember-outsider");
    testUsers.push(outsider);

    const res = await request(app)
      .patch(`/households/mine/members/${outsider.userId}`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ role: "manager" });

    expect(res.status).toBe(404);
  });

  it("role 'owner' in body → 422 (schema rejects it)", async () => {
    const owner = await createTestUser("role-owner-body");
    testUsers.push(owner);
    const viewer = await createTestUserInHousehold("role-owner-body-v", owner.householdId, "viewer");
    testUsers.push(viewer);

    const res = await request(app)
      .patch(`/households/mine/members/${viewer.userId}`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ role: "owner" });

    expect(res.status).toBe(422);
  });
});

// ── DELETE /households/mine/members/:profileId — remove member ────────────────

describe("DELETE /households/mine/members/:profileId", () => {
  it("owner removes viewer → 200; removed user is owner of a new solo household", async () => {
    const owner = await createTestUser("remove-owner");
    testUsers.push(owner);
    const viewer = await createTestUserInHousehold("remove-viewer", owner.householdId, "viewer");
    testUsers.push(viewer);

    const res = await request(app)
      .delete(`/households/mine/members/${viewer.userId}`)
      .set("Authorization", `Bearer ${owner.accessToken}`);

    expect(res.status).toBe(200);

    // Viewer now has their own household
    const mine = await request(app)
      .get("/households/mine")
      .set("Authorization", `Bearer ${viewer.accessToken}`);
    expect(mine.status).toBe(200);
    expect(mine.body.id).not.toBe(owner.householdId);
    expect(mine.body.myRole).toBe("owner");
    expect(mine.body.members).toHaveLength(1);

    // Update cleanup reference so afterEach deletes the new household
    viewer.householdId = mine.body.id as string;
  });

  it("owner self-remove → 403 (self_remove)", async () => {
    const owner = await createTestUser("remove-self");
    testUsers.push(owner);

    const res = await request(app)
      .delete(`/households/mine/members/${owner.userId}`)
      .set("Authorization", `Bearer ${owner.accessToken}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("self_remove");
  });

  it("non-owner cannot remove members → 403", async () => {
    const owner = await createTestUser("remove-nonowner-owner");
    testUsers.push(owner);
    const manager = await createTestUserInHousehold("remove-nonowner-mgr", owner.householdId, "manager");
    testUsers.push(manager);
    const viewer = await createTestUserInHousehold("remove-nonowner-v", owner.householdId, "viewer");
    testUsers.push(viewer);

    const res = await request(app)
      .delete(`/households/mine/members/${viewer.userId}`)
      .set("Authorization", `Bearer ${manager.accessToken}`);

    expect(res.status).toBe(403);
  });

  it("non-member target → 404", async () => {
    const owner = await createTestUser("remove-nonmember-owner");
    testUsers.push(owner);
    const outsider = await createTestUser("remove-nonmember-out");
    testUsers.push(outsider);

    const res = await request(app)
      .delete(`/households/mine/members/${outsider.userId}`)
      .set("Authorization", `Bearer ${owner.accessToken}`);

    expect(res.status).toBe(404);
  });
});

// ── DELETE /households/mine/members/me — leave ────────────────────────────────

describe("DELETE /households/mine/members/me", () => {
  it("viewer leaves → 200; leaver is owner of new solo household", async () => {
    const owner = await createTestUser("leave-owner");
    testUsers.push(owner);
    const viewer = await createTestUserInHousehold("leave-viewer", owner.householdId, "viewer");
    testUsers.push(viewer);

    const res = await request(app)
      .delete("/households/mine/members/me")
      .set("Authorization", `Bearer ${viewer.accessToken}`);

    expect(res.status).toBe(200);

    const mine = await request(app)
      .get("/households/mine")
      .set("Authorization", `Bearer ${viewer.accessToken}`);
    expect(mine.status).toBe(200);
    expect(mine.body.id).not.toBe(owner.householdId);
    expect(mine.body.myRole).toBe("owner");
    expect(mine.body.members).toHaveLength(1);

    viewer.householdId = mine.body.id as string;
  });

  it("owner leaves → 409 (must_transfer_first)", async () => {
    const owner = await createTestUser("leave-owner-blocked");
    testUsers.push(owner);

    const res = await request(app)
      .delete("/households/mine/members/me")
      .set("Authorization", `Bearer ${owner.accessToken}`);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("must_transfer_first");
  });
});

// ── POST /households/mine/transfer-ownership ──────────────────────────────────

describe("POST /households/mine/transfer-ownership", () => {
  it("owner transfers to viewer → 200; roles updated correctly", async () => {
    const owner = await createTestUser("transfer-owner");
    testUsers.push(owner);
    const viewer = await createTestUserInHousehold("transfer-viewer", owner.householdId, "viewer");
    testUsers.push(viewer);

    const res = await request(app)
      .post("/households/mine/transfer-ownership")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ newOwnerProfileId: viewer.userId });

    expect(res.status).toBe(200);

    // Old owner is now manager
    const ownerRows = await adminDb()
      .select({ role: householdMembers.role })
      .from(householdMembers)
      .where(
        and(
          eq(householdMembers.householdId, owner.householdId),
          eq(householdMembers.profileId, owner.userId),
        ),
      );
    expect(ownerRows[0]?.role).toBe("manager");

    // New owner is owner
    const viewerRows = await adminDb()
      .select({ role: householdMembers.role })
      .from(householdMembers)
      .where(
        and(
          eq(householdMembers.householdId, owner.householdId),
          eq(householdMembers.profileId, viewer.userId),
        ),
      );
    expect(viewerRows[0]?.role).toBe("owner");

    // GET /mine from each perspective confirms the final state
    const ownerMine = await request(app)
      .get("/households/mine")
      .set("Authorization", `Bearer ${owner.accessToken}`);
    expect(ownerMine.body.myRole).toBe("manager");

    const viewerMine = await request(app)
      .get("/households/mine")
      .set("Authorization", `Bearer ${viewer.accessToken}`);
    expect(viewerMine.body.myRole).toBe("owner");
  });

  it("self-transfer → 403 (self_transfer)", async () => {
    const owner = await createTestUser("transfer-self");
    testUsers.push(owner);

    const res = await request(app)
      .post("/households/mine/transfer-ownership")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ newOwnerProfileId: owner.userId });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("self_transfer");
  });

  it("non-member target → 404", async () => {
    const owner = await createTestUser("transfer-nonmember-owner");
    testUsers.push(owner);
    const outsider = await createTestUser("transfer-nonmember-out");
    testUsers.push(outsider);

    const res = await request(app)
      .post("/households/mine/transfer-ownership")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ newOwnerProfileId: outsider.userId });

    expect(res.status).toBe(404);
  });

  it("non-owner caller → 403", async () => {
    const owner = await createTestUser("transfer-nonowner-owner");
    testUsers.push(owner);
    const manager = await createTestUserInHousehold("transfer-nonowner-mgr", owner.householdId, "manager");
    testUsers.push(manager);

    const res = await request(app)
      .post("/households/mine/transfer-ownership")
      .set("Authorization", `Bearer ${manager.accessToken}`)
      .send({ newOwnerProfileId: owner.userId });

    expect(res.status).toBe(403);
  });

  it("exactly one owner exists after transfer (no double-owner intermediate state visible externally)", async () => {
    const owner = await createTestUser("transfer-atomic-owner");
    testUsers.push(owner);
    const viewer = await createTestUserInHousehold("transfer-atomic-viewer", owner.householdId, "viewer");
    testUsers.push(viewer);

    await request(app)
      .post("/households/mine/transfer-ownership")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ newOwnerProfileId: viewer.userId });

    const ownerRows = await adminDb()
      .select({ role: householdMembers.role })
      .from(householdMembers)
      .where(
        and(
          eq(householdMembers.householdId, owner.householdId),
          eq(householdMembers.role, "owner"),
        ),
      );
    expect(ownerRows).toHaveLength(1);
    expect(ownerRows[0]?.role).toBe("owner");
  });
});

// ── GET /households/mine/invites ──────────────────────────────────────────────

describe("GET /households/mine/invites", () => {
  it("no pending invite → { invite: null }", async () => {
    const owner = await createTestUser("list-invite-none");
    testUsers.push(owner);

    const res = await request(app)
      .get("/households/mine/invites")
      .set("Authorization", `Bearer ${owner.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.invite).toBeNull();
  });

  it("after generating an invite → returns id, expiresAt, createdAt (no url/token)", async () => {
    const owner = await createTestUser("list-invite-active");
    testUsers.push(owner);

    const gen = await request(app)
      .post("/households/mine/invites")
      .set("Authorization", `Bearer ${owner.accessToken}`);
    expect(gen.status).toBe(201);

    const res = await request(app)
      .get("/households/mine/invites")
      .set("Authorization", `Bearer ${owner.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.invite).not.toBeNull();
    expect(typeof res.body.invite.id).toBe("string");
    expect(typeof res.body.invite.expiresAt).toBe("string");
    expect(typeof res.body.invite.createdAt).toBe("string");
    // Raw token must never be exposed
    expect(res.body.invite.url).toBeUndefined();
    expect(res.body.invite.token).toBeUndefined();
    expect(res.body.invite.tokenHash).toBeUndefined();
  });

  it("non-owner → 403", async () => {
    const owner = await createTestUser("list-invite-nonowner-owner");
    testUsers.push(owner);
    const viewer = await createTestUserInHousehold("list-invite-nonowner-v", owner.householdId, "viewer");
    testUsers.push(viewer);

    const res = await request(app)
      .get("/households/mine/invites")
      .set("Authorization", `Bearer ${viewer.accessToken}`);

    expect(res.status).toBe(403);
  });
});

// ── DELETE /households/mine/invites/:id — revoke invite ───────────────────────

describe("DELETE /households/mine/invites/:id", () => {
  it("owner revokes → 204; subsequent GET returns { invite: null }", async () => {
    const owner = await createTestUser("revoke-owner");
    testUsers.push(owner);

    const gen = await request(app)
      .post("/households/mine/invites")
      .set("Authorization", `Bearer ${owner.accessToken}`);
    expect(gen.status).toBe(201);
    const inviteId = gen.body.id as string;

    const revoke = await request(app)
      .delete(`/households/mine/invites/${inviteId}`)
      .set("Authorization", `Bearer ${owner.accessToken}`);

    expect(revoke.status).toBe(204);

    const list = await request(app)
      .get("/households/mine/invites")
      .set("Authorization", `Bearer ${owner.accessToken}`);
    expect(list.body.invite).toBeNull();
  });

  it("wrong household's invite id → 404", async () => {
    const owner1 = await createTestUser("revoke-wrong-owner1");
    testUsers.push(owner1);
    const owner2 = await createTestUser("revoke-wrong-owner2");
    testUsers.push(owner2);

    const gen = await request(app)
      .post("/households/mine/invites")
      .set("Authorization", `Bearer ${owner1.accessToken}`);
    expect(gen.status).toBe(201);
    const inviteId = gen.body.id as string;

    const res = await request(app)
      .delete(`/households/mine/invites/${inviteId}`)
      .set("Authorization", `Bearer ${owner2.accessToken}`);

    expect(res.status).toBe(404);
  });

  it("non-owner → 403", async () => {
    const owner = await createTestUser("revoke-nonowner-owner");
    testUsers.push(owner);
    const viewer = await createTestUserInHousehold("revoke-nonowner-v", owner.householdId, "viewer");
    testUsers.push(viewer);

    const gen = await request(app)
      .post("/households/mine/invites")
      .set("Authorization", `Bearer ${owner.accessToken}`);
    const inviteId = gen.body.id as string;

    const res = await request(app)
      .delete(`/households/mine/invites/${inviteId}`)
      .set("Authorization", `Bearer ${viewer.accessToken}`);

    expect(res.status).toBe(403);
  });
});
