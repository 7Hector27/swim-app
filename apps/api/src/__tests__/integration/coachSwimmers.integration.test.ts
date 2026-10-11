import { afterAll, afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import pino from "pino";
import { eq } from "drizzle-orm";
import { createApp } from "../../app";
import { guardians, leagueRegistrations, profiles, swimmerClubs, swimmers } from "../../db/schema";
import { adminDb, closeAdminDb, createTestUser } from "./helpers";

const logger = pino({ level: "silent" });
const app = createApp(logger);

const createdSwimmerIds = new Set<string>();

async function hardDeleteSwimmer(swimmerId: string): Promise<void> {
  await adminDb().delete(leagueRegistrations).where(eq(leagueRegistrations.swimmerId, swimmerId));
  await adminDb().delete(swimmerClubs).where(eq(swimmerClubs.swimmerId, swimmerId));
  await adminDb().delete(guardians).where(eq(guardians.swimmerId, swimmerId));
  await adminDb().delete(swimmers).where(eq(swimmers.id, swimmerId));
}

afterEach(async () => {
  for (const swimmerId of createdSwimmerIds) {
    await hardDeleteSwimmer(swimmerId).catch(() => {
      /* ignore */
    });
  }
  createdSwimmerIds.clear();
});

afterAll(async () => {
  await closeAdminDb();
});

async function makeCoach(userId: string): Promise<void> {
  await adminDb().update(profiles).set({ role: "coach" }).where(eq(profiles.id, userId));
}

async function createParentSwimmer(accessToken: string): Promise<string> {
  const res = await request(app)
    .post("/swimmers")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({
      firstName: "Testy",
      lastName: "McTestface",
      birthDate: "2015-06-01",
      sex: "female" as const,
      isPublic: false,
      clubs: [],
    });
  expect(res.status).toBe(201);
  const swimmerId = res.body.id as string;
  createdSwimmerIds.add(swimmerId);
  return swimmerId;
}

// ── Coach sees all parents' swimmers ─────────────────────────────────────────

describe("GET /coach/swimmers — coach sees all parents' swimmers", () => {
  it("returns swimmers from multiple parents", async () => {
    const parentA = await createTestUser("coach-roster-parentA");
    const parentB = await createTestUser("coach-roster-parentB");
    const coach = await createTestUser("coach-roster-coach");
    await makeCoach(coach.userId);

    try {
      // Sign coach in again after role change to refresh their profile cache
      const swimmerIdA = await createParentSwimmer(parentA.accessToken);
      const swimmerIdB = await createParentSwimmer(parentB.accessToken);

      const res = await request(app)
        .get("/coach/swimmers")
        .set("Authorization", `Bearer ${coach.accessToken}`);

      expect(res.status).toBe(200);
      const ids = (res.body as Array<{ id: string }>).map((s) => s.id);
      expect(ids).toContain(swimmerIdA);
      expect(ids).toContain(swimmerIdB);
    } finally {
      await parentA.cleanup();
      await parentB.cleanup();
      await coach.cleanup();
    }
  });
});

// ── Archived swimmers excluded ────────────────────────────────────────────────

describe("GET /coach/swimmers — archived excluded", () => {
  it("does not return archived swimmers", async () => {
    const parent = await createTestUser("coach-archived-parent");
    const coach = await createTestUser("coach-archived-coach");
    await makeCoach(coach.userId);

    try {
      const swimmerId = await createParentSwimmer(parent.accessToken);

      await adminDb()
        .update(swimmers)
        .set({ archivedAt: new Date() })
        .where(eq(swimmers.id, swimmerId));

      const res = await request(app)
        .get("/coach/swimmers")
        .set("Authorization", `Bearer ${coach.accessToken}`);

      expect(res.status).toBe(200);
      const ids = (res.body as Array<{ id: string }>).map((s) => s.id);
      expect(ids).not.toContain(swimmerId);
    } finally {
      await parent.cleanup();
      await coach.cleanup();
    }
  });

  it("GET /coach/swimmers/:id returns 404 for archived swimmer", async () => {
    const parent = await createTestUser("coach-archived-detail-parent");
    const coach = await createTestUser("coach-archived-detail-coach");
    await makeCoach(coach.userId);

    try {
      const swimmerId = await createParentSwimmer(parent.accessToken);

      await adminDb()
        .update(swimmers)
        .set({ archivedAt: new Date() })
        .where(eq(swimmers.id, swimmerId));

      const res = await request(app)
        .get(`/coach/swimmers/${swimmerId}`)
        .set("Authorization", `Bearer ${coach.accessToken}`);

      expect(res.status).toBe(404);
    } finally {
      await parent.cleanup();
      await coach.cleanup();
    }
  });
});

// ── Visibility — sets false, keeps consent fields ─────────────────────────────

describe("PATCH /coach/swimmers/:id/visibility — sets isPublic false", () => {
  it("sets isPublic to false and preserves publicConsentAt/publicConsentBy", async () => {
    const parent = await createTestUser("coach-visibility-parent");
    const coach = await createTestUser("coach-visibility-coach");
    await makeCoach(coach.userId);

    try {
      // Create swimmer as public so there are consent fields to preserve
      const res = await request(app)
        .post("/swimmers")
        .set("Authorization", `Bearer ${parent.accessToken}`)
        .send({
          firstName: "Testy",
          lastName: "McTestface",
          birthDate: "2015-06-01",
          sex: "female" as const,
          isPublic: true,
          clubs: [],
        });
      expect(res.status).toBe(201);
      const swimmerId = res.body.id as string;
      createdSwimmerIds.add(swimmerId);

      const rowBefore = await adminDb()
        .select()
        .from(swimmers)
        .where(eq(swimmers.id, swimmerId))
        .limit(1);
      expect(rowBefore[0]?.publicConsentAt).not.toBeNull();
      expect(rowBefore[0]?.publicConsentBy).not.toBeNull();

      const patchRes = await request(app)
        .patch(`/coach/swimmers/${swimmerId}/visibility`)
        .set("Authorization", `Bearer ${coach.accessToken}`)
        .send({ isPublic: false });

      expect(patchRes.status).toBe(204);

      const rowAfter = await adminDb()
        .select()
        .from(swimmers)
        .where(eq(swimmers.id, swimmerId))
        .limit(1);

      expect(rowAfter[0]?.isPublic).toBe(false);
      expect(rowAfter[0]?.publicConsentAt).toEqual(rowBefore[0]?.publicConsentAt);
      expect(rowAfter[0]?.publicConsentBy).toEqual(rowBefore[0]?.publicConsentBy);
    } finally {
      await parent.cleanup();
      await coach.cleanup();
    }
  });

  it("is idempotent when swimmer is already hidden", async () => {
    const parent = await createTestUser("coach-visibility-idem-parent");
    const coach = await createTestUser("coach-visibility-idem-coach");
    await makeCoach(coach.userId);

    try {
      const swimmerId = await createParentSwimmer(parent.accessToken);

      const res = await request(app)
        .patch(`/coach/swimmers/${swimmerId}/visibility`)
        .set("Authorization", `Bearer ${coach.accessToken}`)
        .send({ isPublic: false });

      expect(res.status).toBe(204);
    } finally {
      await parent.cleanup();
      await coach.cleanup();
    }
  });
});

// ── Parent blocked from coach routes ─────────────────────────────────────────

describe("parent 403 on coach routes", () => {
  it("GET /coach/swimmers → 403 for parent", async () => {
    const parent = await createTestUser("coach-403-parent-list");
    try {
      const res = await request(app)
        .get("/coach/swimmers")
        .set("Authorization", `Bearer ${parent.accessToken}`);
      expect(res.status).toBe(403);
    } finally {
      await parent.cleanup();
    }
  });

  it("PATCH /coach/swimmers/:id/visibility → 403 for parent", async () => {
    const parent = await createTestUser("coach-403-parent-vis");
    const otherParent = await createTestUser("coach-403-other-parent");

    try {
      const swimmerId = await createParentSwimmer(otherParent.accessToken);

      const res = await request(app)
        .patch(`/coach/swimmers/${swimmerId}/visibility`)
        .set("Authorization", `Bearer ${parent.accessToken}`)
        .send({ isPublic: false });

      expect(res.status).toBe(403);
    } finally {
      await parent.cleanup();
      await otherParent.cleanup();
    }
  });
});
