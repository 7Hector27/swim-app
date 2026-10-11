import { afterAll, afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import pino from "pino";
import { eq } from "drizzle-orm";
import { createApp } from "../../app";
import {
  guardians,
  swimmerClubs,
  swimmers,
} from "../../db/schema";
import { ParentSwimmerSchema } from "@swim-app/shared";
import { adminDb, closeAdminDb, createTestUser } from "./helpers";

const logger = pino({ level: "silent" });
const app = createApp(logger);

// Track swimmer rows created across tests so we can delete them even when a
// test fails before its own cleanup runs. Auth-user cleanup cascades to
// profiles/guardians/swimmer_clubs, but swimmers reference profiles via
// publicConsentBy ON DELETE RESTRICT, so stray swimmers can block profile
// deletes. We hard-delete them in afterEach.
const createdSwimmerIds = new Set<string>();

async function hardDeleteSwimmer(swimmerId: string): Promise<void> {
  await adminDb()
    .delete(swimmerClubs)
    .where(eq(swimmerClubs.swimmerId, swimmerId));
  await adminDb()
    .delete(guardians)
    .where(eq(guardians.swimmerId, swimmerId));
  await adminDb().delete(swimmers).where(eq(swimmers.id, swimmerId));
}

afterEach(async () => {
  for (const swimmerId of createdSwimmerIds) {
    await hardDeleteSwimmer(swimmerId).catch(() => {
      /* ignore — the row may already be gone */
    });
  }
  createdSwimmerIds.clear();
});

afterAll(async () => {
  await closeAdminDb();
});

function validSwimmerBody(overrides: Record<string, unknown> = {}) {
  return {
    firstName: "Testy",
    lastName: "McTestface",
    birthDate: "2015-06-01",
    sex: "female" as const,
    isPublic: false,
    clubs: [],
    ...overrides,
  };
}

describe("POST /swimmers — atomicity", () => {
  it("rolls back swimmer and guardian rows when clubId does not exist", async () => {
    const parent = await createTestUser("atomic");
    // Unique per run so the swimmer-name assertion is unambiguous.
    const uniqueFirstName = `Atomic-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    try {
      const fakeClubId = "00000000-0000-4000-8000-000000000000";
      const res = await request(app)
        .post("/swimmers")
        .set("Authorization", `Bearer ${parent.accessToken}`)
        .send(validSwimmerBody({ firstName: uniqueFirstName, clubs: [{ clubId: fakeClubId }] }));

      // FK violation surfaces as either 500 (unhandled DB error) or 422 — both
      // acceptable; the point is nothing is left in the DB.
      expect([422, 500]).toContain(res.status);

      // No swimmer row with the unique name should exist.
      const swimmerRows = await adminDb()
        .select({ id: swimmers.id })
        .from(swimmers)
        .where(eq(swimmers.firstName, uniqueFirstName));
      expect(swimmerRows).toHaveLength(0);

      // No guardian row linking this parent to any swimmer.
      const guardianRows = await adminDb()
        .select()
        .from(guardians)
        .where(eq(guardians.profileId, parent.userId));
      expect(guardianRows).toHaveLength(0);

      // No swimmer_clubs row pointing at the fake club.
      const clubRows = await adminDb()
        .select()
        .from(swimmerClubs)
        .where(eq(swimmerClubs.clubId, fakeClubId));
      expect(clubRows).toHaveLength(0);
    } finally {
      await parent.cleanup();
    }
  });
});

describe("POST /swimmers — response shape", () => {
  it("returns a body that parses against ParentSwimmerSchema", async () => {
    const parent = await createTestUser("shape");

    try {
      const res = await request(app)
        .post("/swimmers")
        .set("Authorization", `Bearer ${parent.accessToken}`)
        .send(validSwimmerBody({ isPublic: false, clubs: [] }));

      expect(res.status).toBe(201);
      if (typeof res.body?.id === "string") {
        createdSwimmerIds.add(res.body.id);
      }

      const parsed = ParentSwimmerSchema.safeParse(res.body);
      if (!parsed.success) {
        throw new Error(
          `ParentSwimmerSchema parse failed: ${JSON.stringify(parsed.error.issues)}`,
        );
      }
      expect(parsed.success).toBe(true);
    } finally {
      await parent.cleanup();
    }
  });
});

describe("parent isolation", () => {
  it("Parent B cannot GET/PATCH/DELETE Parent A's swimmer", async () => {
    const parentA = await createTestUser("isolation-a");
    const parentB = await createTestUser("isolation-b");

    try {
      const createRes = await request(app)
        .post("/swimmers")
        .set("Authorization", `Bearer ${parentA.accessToken}`)
        .send(validSwimmerBody());
      expect(createRes.status).toBe(201);
      const swimmerId = createRes.body.id as string;
      createdSwimmerIds.add(swimmerId);

      const getRes = await request(app)
        .get(`/swimmers/${swimmerId}`)
        .set("Authorization", `Bearer ${parentB.accessToken}`);
      expect(getRes.status).toBe(404);

      const patchRes = await request(app)
        .patch(`/swimmers/${swimmerId}`)
        .set("Authorization", `Bearer ${parentB.accessToken}`)
        .send({ firstName: "Hacked" });
      expect(patchRes.status).toBe(404);

      const deleteRes = await request(app)
        .delete(`/swimmers/${swimmerId}`)
        .set("Authorization", `Bearer ${parentB.accessToken}`);
      expect(deleteRes.status).toBe(404);
    } finally {
      await parentB.cleanup();
      await parentA.cleanup();
    }
  });
});

describe("consent fields are server-controlled", () => {
  it("rejects client-sent publicConsentBy and sets consent server-side on isPublic:true", async () => {
    const parent = await createTestUser("consent");

    try {
      // Strict schema should reject the unknown field.
      const fakeConsentBy = "11111111-1111-4111-8111-111111111111";
      const rejectRes = await request(app)
        .post("/swimmers")
        .set("Authorization", `Bearer ${parent.accessToken}`)
        .send(
          validSwimmerBody({
            isPublic: true,
            publicConsentBy: fakeConsentBy,
          }),
        );
      expect(rejectRes.status).toBe(422);

      // Clean POST — server fills consent fields itself.
      const createRes = await request(app)
        .post("/swimmers")
        .set("Authorization", `Bearer ${parent.accessToken}`)
        .send(validSwimmerBody({ isPublic: true }));
      expect(createRes.status).toBe(201);
      const swimmerId = createRes.body.id as string;
      createdSwimmerIds.add(swimmerId);

      // publicConsentAt is returned to parents; publicConsentBy is omitted
      // from the ParentSwimmer shape.
      expect(createRes.body.publicConsentAt).toBeTruthy();
      expect(createRes.body.publicConsentBy).toBeUndefined();

      // DB has the caller's id, not any client-supplied value.
      const dbRows = await adminDb()
        .select({
          publicConsentBy: swimmers.publicConsentBy,
          publicConsentAt: swimmers.publicConsentAt,
        })
        .from(swimmers)
        .where(eq(swimmers.id, swimmerId));
      expect(dbRows[0]?.publicConsentBy).toBe(parent.userId);
      expect(dbRows[0]?.publicConsentAt).not.toBeNull();
    } finally {
      await parent.cleanup();
    }
  });
});

describe("archived swimmer visibility", () => {
  it("DELETE archives, then GET /me returns [] and GET /:id returns 404", async () => {
    const parent = await createTestUser("archive");

    try {
      const createRes = await request(app)
        .post("/swimmers")
        .set("Authorization", `Bearer ${parent.accessToken}`)
        .send(validSwimmerBody());
      expect(createRes.status).toBe(201);
      const swimmerId = createRes.body.id as string;
      createdSwimmerIds.add(swimmerId);

      const deleteRes = await request(app)
        .delete(`/swimmers/${swimmerId}`)
        .set("Authorization", `Bearer ${parent.accessToken}`);
      expect(deleteRes.status).toBe(204);

      const meRes = await request(app)
        .get("/swimmers/me")
        .set("Authorization", `Bearer ${parent.accessToken}`);
      expect(meRes.status).toBe(200);
      expect(meRes.body).toEqual([]);

      const getRes = await request(app)
        .get(`/swimmers/${swimmerId}`)
        .set("Authorization", `Bearer ${parent.accessToken}`);
      expect(getRes.status).toBe(404);

      // Sanity-check the row is still in the DB with archivedAt set — i.e. soft delete.
      const dbRows = await adminDb()
        .select({ archivedAt: swimmers.archivedAt })
        .from(swimmers)
        .where(eq(swimmers.id, swimmerId));
      expect(dbRows[0]?.archivedAt).not.toBeNull();
    } finally {
      await parent.cleanup();
    }
  });
});
