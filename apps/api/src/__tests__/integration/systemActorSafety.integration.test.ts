// Guard tests for SYSTEM_ACTOR_ID (migration 0087).
//
// The seeded system profile row satisfies household_audit_log.actor_id
// NOT NULL for refunds triggered by background sweeps (cron's
// expired-pending pass, GET /coach/lessons's lazy-expiry). This file
// pins the invariants that keep the row from leaking anywhere:
//
//   1. It exists in `profiles` and has no matching `auth.users` row,
//      so it can never present a valid auth token.
//   2. It has role `parent` (not `coach`), so `getActiveCoachProfile`
//      — the single gatekeeper for "who is the coach?" — cannot
//      return it.
//   3. It has no `household_members` row, so every parent/coach query
//      that joins through `household_members` naturally excludes it.
//   4. `household_audit_log.actor_id` is `ON DELETE RESTRICT` on the
//      FK to `profiles.id`, so once the SYSTEM row carries any audit
//      row it cannot be deleted.
//   5. No profile list the app exposes (coach families, coach roster,
//      coach household search, parent household members, balance
//      history) surfaces the SYSTEM row.
//
// If any of these invariants break, this file fails loudly — the
// right response is to add a filter at the leaking query rather than
// to change the seed.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import pino from "pino";
import { eq, sql } from "drizzle-orm";

import { createApp } from "../../app";
import { SYSTEM_ACTOR_ID } from "../../services/balance";
import {
  householdAuditLog,
  householdMembers,
  profiles,
} from "../../db/schema";
import {
  adminDb,
  closeAdminDb,
  createTestUser,
  type TestUser,
} from "./helpers";

const app = createApp(pino({ level: "silent" }));

let coach: TestUser;
let owner: TestUser;

beforeAll(async () => {
  coach = await createTestUser("system-actor-safety-coach");
  await adminDb()
    .update(profiles)
    .set({ role: "coach" })
    .where(eq(profiles.id, coach.userId));
  owner = await createTestUser("system-actor-safety-owner");
});

afterAll(async () => {
  await owner.cleanup();
  await coach.cleanup();
  await closeAdminDb();
});

describe("SYSTEM_ACTOR_ID row shape", () => {
  it("exists in profiles with role parent and name 'System'", async () => {
    const rows = await adminDb()
      .select({
        id: profiles.id,
        role: profiles.role,
        fullName: profiles.fullName,
        email: profiles.email,
        disabledAt: profiles.disabledAt,
      })
      .from(profiles)
      .where(eq(profiles.id, SYSTEM_ACTOR_ID))
      .limit(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.role).toBe("parent");
    expect(rows[0]?.fullName).toBe("System");
    // Null email keeps the sentinel from colliding with any real
    // signup's unique-email constraint.
    expect(rows[0]?.email).toBeNull();
    expect(rows[0]?.disabledAt).toBeNull();
  });

  it("has no matching auth.users row — cannot log in", async () => {
    const rows = await adminDb().execute<{ count: string }>(sql`
      SELECT COUNT(*)::text AS count
      FROM auth.users
      WHERE id = ${SYSTEM_ACTOR_ID}::uuid
    `);
    expect(rows[0]?.count).toBe("0");
  });

  it("has no household_members row — every household-scoped join excludes it", async () => {
    const rows = await adminDb()
      .select({ profileId: householdMembers.profileId })
      .from(householdMembers)
      .where(eq(householdMembers.profileId, SYSTEM_ACTOR_ID));
    expect(rows).toHaveLength(0);
  });
});

describe("SYSTEM_ACTOR_ID is unreachable by coach-resolver queries", () => {
  it("getActiveCoachProfile cannot return the SYSTEM row (role filter excludes it)", async () => {
    // Pull the module fresh — it's the single gatekeeper for "who is
    // the coach?" across Google Calendar sync, outbox render, and the
    // notifications drain.
    const { getActiveCoachProfile } = await import("../../lib/coachProfile");
    const active = await getActiveCoachProfile();
    // There must be at least one coach in the test stack for assertions to
    // be meaningful; if none is seeded this test has nothing to say.
    expect(active).not.toBeNull();
    expect(active!.id).not.toBe(SYSTEM_ACTOR_ID);
  });
});

describe("SYSTEM_ACTOR_ID cannot be deleted while any audit row references it", () => {
  it("DELETE on profiles(id = SYSTEM_ACTOR_ID) raises foreign-key RESTRICT", async () => {
    // Seed one audit row attributed to SYSTEM so the RESTRICT FK on
    // household_audit_log.actor_id has something to protect. Use the
    // owner's household so the row has the correct NOT NULL fields;
    // the row is cleaned up at the end of the test to keep the suite
    // idempotent.
    const [household] = await adminDb()
      .select({ householdId: householdMembers.householdId })
      .from(householdMembers)
      .where(eq(householdMembers.profileId, owner.userId))
      .limit(1);
    const householdId = household!.householdId;

    const inserted = await adminDb()
      .insert(householdAuditLog)
      .values({
        householdId,
        actorId: SYSTEM_ACTOR_ID,
        action: "system_actor_safety_probe",
        payload: {},
      })
      .returning({ id: householdAuditLog.id });
    const auditId = inserted[0]!.id;

    try {
      await expect(
        adminDb().delete(profiles).where(eq(profiles.id, SYSTEM_ACTOR_ID)),
      ).rejects.toThrow(/foreign key|violates|restrict/i);

      // Row still there.
      const stillThere = await adminDb()
        .select({ id: profiles.id })
        .from(profiles)
        .where(eq(profiles.id, SYSTEM_ACTOR_ID))
        .limit(1);
      expect(stillThere).toHaveLength(1);
    } finally {
      await adminDb().delete(householdAuditLog).where(eq(householdAuditLog.id, auditId));
    }
  });
});

describe("SYSTEM_ACTOR_ID does not surface in any profile-listing route", () => {
  it("GET /households/mine does not list SYSTEM as a member", async () => {
    const res = await request(app)
      .get("/households/mine")
      .set("Authorization", `Bearer ${owner.accessToken}`);
    expect(res.status).toBe(200);
    const memberIds = (res.body.members as Array<{ profileId: string }>)
      .map((member) => member.profileId);
    expect(memberIds).not.toContain(SYSTEM_ACTOR_ID);
  });

  it("GET /coach/households (families list) does not include SYSTEM", async () => {
    const res = await request(app)
      .get("/coach/households")
      .set("Authorization", `Bearer ${coach.accessToken}`);
    expect(res.status).toBe(200);
    // Response is a list of household summaries — the SYSTEM row would
    // only sneak in via a household_members membership it doesn't have.
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain(SYSTEM_ACTOR_ID);
    expect(serialized).not.toContain("System");
  });

  it("GET /coach/swimmers (roster) does not include SYSTEM", async () => {
    const res = await request(app)
      .get("/coach/swimmers")
      .set("Authorization", `Bearer ${coach.accessToken}`);
    expect(res.status).toBe(200);
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain(SYSTEM_ACTOR_ID);
  });

  it("GET /coach/households?q=System does not return the SYSTEM row even on a matching name search", async () => {
    // The search trigram-matches household_members.profiles.fullName and
    // the household's own name. The SYSTEM row's full_name is exactly
    // "System", so if the search ever reached profiles without first
    // scoping through household_members, this call would surface it.
    const res = await request(app)
      .get("/coach/households")
      .query({ q: "System" })
      .set("Authorization", `Bearer ${coach.accessToken}`);
    expect([200, 404]).toContain(res.status);
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain(SYSTEM_ACTOR_ID);
  });

  it("GET /me/balance/history does not expose an actor name for sweep refunds", async () => {
    const res = await request(app)
      .get("/me/balance/history")
      .set("Authorization", `Bearer ${owner.accessToken}`);
    expect(res.status).toBe(200);
    const serialized = JSON.stringify(res.body);
    // Current contract: the actor's name is never serialized in balance
    // history responses — only entryType + reason. Pinning the negative
    // guard here so a future column addition that surfaces the name
    // forces this test to update and re-ask the privacy question.
    expect(serialized).not.toContain("System");
    expect(serialized).not.toContain(SYSTEM_ACTOR_ID);
  });
});
