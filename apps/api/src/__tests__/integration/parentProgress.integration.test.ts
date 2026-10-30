// Tests for GET /swimmers/:id/progress (parent route)

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import request from "supertest";
import pino from "pino";
import { createApp } from "../../app";
import {
  adminDb,
  closeAdminDb,
  createTestUser,
  createTestUserInHousehold,
  hardDeleteSwimmer,
} from "./helpers";
import type { TestUser } from "./helpers";
import { evaluationSessions, profiles, skillRatings, skills, swimmers } from "../../db/schema";
import syncCatalogFn from "../../db/scripts/syncCatalogFn";

const logger = pino({ level: "silent" });
const app = createApp(logger);

let owner: TestUser;
let viewer: TestUser;
let otherHousehold: TestUser;
let swimmerId: string;
let skillId: string;

beforeAll(async () => {
  await syncCatalogFn(adminDb());

  owner = await createTestUser("parent-progress-owner");

  // Lookup a real skill
  const skillRows = await adminDb()
    .select({ id: skills.id })
    .from(skills)
    .where(eq(skills.slug, "free-kick"))
    .limit(1);
  if (!skillRows[0]) throw new Error("free-kick skill not found");
  skillId = skillRows[0].id;

  // Create swimmer in owner's household
  const swimmerRows = await adminDb()
    .insert(swimmers)
    .values({
      firstName: "Test",
      lastName: "Swimmer",
      birthDate: "2015-01-01",
      sex: "female",
      isPublic: false,
      householdId: owner.householdId,
    })
    .returning({ id: swimmers.id });
  swimmerId = swimmerRows[0]!.id;

  // Create viewer in same household
  viewer = await createTestUserInHousehold("parent-progress-viewer", owner.householdId, "viewer");

  // Create user in a different household
  otherHousehold = await createTestUser("parent-progress-other");
});

afterAll(async () => {
  await adminDb().delete(skillRatings).where(eq(skillRatings.swimmerId, swimmerId));
  await adminDb().delete(evaluationSessions).where(eq(evaluationSessions.swimmerId, swimmerId));
  await hardDeleteSwimmer(swimmerId);
  await viewer.cleanup();
  await otherHousehold.cleanup();
  await owner.cleanup();
  await closeAdminDb();
});

describe("GET /swimmers/:id/progress", () => {
  it("owner gets 200 with progress data", async () => {
    const res = await request(app)
      .get(`/swimmers/${swimmerId}/progress`)
      .set("Authorization", `Bearer ${owner.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("skills");
    expect(res.body).toHaveProperty("startProgress");
    expect(res.body).toHaveProperty("coachingPriorities");
  });

  it("viewer (household member) gets 200", async () => {
    const res = await request(app)
      .get(`/swimmers/${swimmerId}/progress`)
      .set("Authorization", `Bearer ${viewer.accessToken}`);
    expect(res.status).toBe(200);
  });

  it("other household gets 404", async () => {
    const res = await request(app)
      .get(`/swimmers/${swimmerId}/progress`)
      .set("Authorization", `Bearer ${otherHousehold.accessToken}`);
    expect(res.status).toBe(404);
  });

  it("no faultTags in response", async () => {
    const coach = await createTestUser("parent-progress-coach-temp");
    await adminDb().update(profiles).set({ role: "coach" }).where(eq(profiles.id, coach.userId));

    const sessionRes = await request(app)
      .post(`/coach/swimmers/${swimmerId}/sessions`)
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send({
        screenSlug: "freestyle",
        breathingPattern: "every_3",
        sessionDate: "2026-10-10",
        context: "practice",
        coachingPriority: "Work on kick",
        ratings: [
          {
            skillId,
            grade: 3,
            notLegal: false,
            noConcept: false,
            side: null,
            capacityValue: null,
            capacityUnit: null,
            measurementValue: null,
            measurementUnit: null,
            note: null,
            faultTags: [],
            ratedAt: "2026-10-10T10:00:00.000Z",
          },
        ],
      });
    expect(sessionRes.status).toBe(201);

    const res = await request(app)
      .get(`/swimmers/${swimmerId}/progress`)
      .set("Authorization", `Bearer ${owner.accessToken}`);
    expect(res.status).toBe(200);

    // Assert no faultTags field anywhere in skills history
    for (const skill of res.body.skills as Array<{ history: unknown[] }>) {
      for (const point of skill.history) {
        expect(point).not.toHaveProperty("faultTags");
      }
    }

    // Cleanup
    await adminDb().delete(skillRatings).where(eq(skillRatings.swimmerId, swimmerId));
    await adminDb().delete(evaluationSessions).where(eq(evaluationSessions.swimmerId, swimmerId));
    await coach.cleanup();
  });

  it("coach token gets 403 on GET /swimmers/:id/progress", async () => {
    const coach = await createTestUser("parent-progress-coach-role");
    await adminDb().update(profiles).set({ role: "coach" }).where(eq(profiles.id, coach.userId));

    const res = await request(app)
      .get(`/swimmers/${swimmerId}/progress`)
      .set("Authorization", `Bearer ${coach.accessToken}`);
    expect(res.status).toBe(403);

    await coach.cleanup();
  });

  it("voided ratings excluded", async () => {
    const coach = await createTestUser("parent-progress-coach-void");
    await adminDb().update(profiles).set({ role: "coach" }).where(eq(profiles.id, coach.userId));

    const session1 = await request(app)
      .post(`/coach/swimmers/${swimmerId}/sessions`)
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send({
        screenSlug: "freestyle",
        breathingPattern: "every_3",
        sessionDate: "2026-10-11",
        context: "practice",
        coachingPriority: "Kick",
        ratings: [
          {
            skillId,
            grade: 4,
            notLegal: false,
            noConcept: false,
            side: null,
            capacityValue: null,
            capacityUnit: null,
            measurementValue: null,
            measurementUnit: null,
            note: null,
            faultTags: [],
            ratedAt: "2026-10-11T10:00:00.000Z",
          },
        ],
      });
    expect(session1.status).toBe(201);

    const session2 = await request(app)
      .post(`/coach/swimmers/${swimmerId}/sessions`)
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send({
        screenSlug: "freestyle",
        breathingPattern: "every_3",
        sessionDate: "2026-10-11",
        context: "practice",
        coachingPriority: "Kick",
        ratings: [
          {
            skillId,
            grade: 1,
            notLegal: false,
            noConcept: false,
            side: null,
            capacityValue: null,
            capacityUnit: null,
            measurementValue: null,
            measurementUnit: null,
            note: null,
            faultTags: [],
            ratedAt: "2026-10-11T11:00:00.000Z",
          },
        ],
      });
    expect(session2.status).toBe(201);

    const { ratingIds: ratingIds2 } = session2.body as { ratingIds: string[] };
    await request(app)
      .patch(`/coach/ratings/${ratingIds2[0]}/void`)
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send({ reason: "Error" });

    const res = await request(app)
      .get(`/swimmers/${swimmerId}/progress`)
      .set("Authorization", `Bearer ${owner.accessToken}`);
    expect(res.status).toBe(200);

    const matchingSkill = (res.body.skills as Array<{ skillId: string; history: Array<{ grade: number }>; current: { grade: number } }>)
      .find((s) => s.skillId === skillId);
    expect(matchingSkill).toBeDefined();
    expect(matchingSkill!.history).toHaveLength(1);
    expect(matchingSkill!.history[0]!.grade).toBe(4);
    expect(matchingSkill!.current.grade).toBe(4);

    // Cleanup
    await adminDb().delete(skillRatings).where(eq(skillRatings.swimmerId, swimmerId));
    await adminDb().delete(evaluationSessions).where(eq(evaluationSessions.swimmerId, swimmerId));
    await coach.cleanup();
  });
});

// ── GET /swimmers/:id/score-history (parent route) ─────────────────────────

describe("GET /swimmers/:id/score-history (parent)", () => {
  // Coaches created inside this block cannot be cleaned up until every
  // evaluation session they wrote has been deleted (ON DELETE RESTRICT on
  // evaluation_sessions.coach_id). Collect them and clean up in afterAll.
  const seedCoaches: TestUser[] = [];

  afterAll(async () => {
    await adminDb().delete(skillRatings).where(eq(skillRatings.swimmerId, swimmerId));
    await adminDb().delete(evaluationSessions).where(eq(evaluationSessions.swimmerId, swimmerId));
    for (const coach of seedCoaches) {
      await coach.cleanup();
    }
  });

  async function seedRating(options: {
    grade: 1 | 2 | 3 | 4 | 5;
    sessionDate: string;
    ratedAt: string;
    faultTags?: string[];
  }): Promise<{ ratingId: string; coach: TestUser }> {
    const coach = await createTestUser("parent-sh-seed-coach");
    await adminDb().update(profiles).set({ role: "coach" }).where(eq(profiles.id, coach.userId));
    seedCoaches.push(coach);
    const sessionRes = await request(app)
      .post(`/coach/swimmers/${swimmerId}/sessions`)
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send({
        screenSlug: "freestyle",
        breathingPattern: "every_3",
        sessionDate: options.sessionDate,
        context: "practice",
        coachingPriority: "Kick",
        ratings: [
          {
            skillId,
            grade: options.grade,
            notLegal: false,
            noConcept: false,
            side: null,
            capacityValue: null,
            capacityUnit: null,
            measurementValue: null,
            measurementUnit: null,
            note: null,
            faultTags: options.faultTags ?? [],
            ratedAt: options.ratedAt,
          },
        ],
      });
    expect(sessionRes.status).toBe(201);
    const ratingId = (sessionRes.body as { ratingIds: string[] }).ratingIds[0]!;
    return { ratingId, coach };
  }

  async function clearSwimmerSessions(): Promise<void> {
    await adminDb().delete(skillRatings).where(eq(skillRatings.swimmerId, swimmerId));
    await adminDb().delete(evaluationSessions).where(eq(evaluationSessions.swimmerId, swimmerId));
  }

  it("a swimmer with no evaluations returns an empty points array", async () => {
    // Runs first so no prior test's data leaks in.
    await clearSwimmerSessions();
    const res = await request(app)
      .get(`/swimmers/${swimmerId}/score-history`)
      .set("Authorization", `Bearer ${owner.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      points: [],
      recentChanges: [],
      milestones: [],
      measurements: [],
    });
  });

  it("owner gets 200 and viewer (household member) gets 200; other household gets 404", async () => {
    await clearSwimmerSessions();
    await seedRating({ grade: 3, sessionDate: "2026-10-12", ratedAt: "2026-10-12T10:00:00.000Z" });

    const ownerRes = await request(app)
      .get(`/swimmers/${swimmerId}/score-history`)
      .set("Authorization", `Bearer ${owner.accessToken}`);
    expect(ownerRes.status).toBe(200);
    expect(Array.isArray(ownerRes.body.points)).toBe(true);
    expect(ownerRes.body.points.length).toBeGreaterThan(0);

    const viewerRes = await request(app)
      .get(`/swimmers/${swimmerId}/score-history`)
      .set("Authorization", `Bearer ${viewer.accessToken}`);
    expect(viewerRes.status).toBe(200);

    const otherRes = await request(app)
      .get(`/swimmers/${swimmerId}/score-history`)
      .set("Authorization", `Bearer ${otherHousehold.accessToken}`);
    expect(otherRes.status).toBe(404);
  });

  it("coach token gets 403 (requireParent)", async () => {
    const coach = await createTestUser("parent-sh-coach-role");
    await adminDb().update(profiles).set({ role: "coach" }).where(eq(profiles.id, coach.userId));

    const res = await request(app)
      .get(`/swimmers/${swimmerId}/score-history`)
      .set("Authorization", `Bearer ${coach.accessToken}`);
    expect(res.status).toBe(403);

    await coach.cleanup();
  });

  it("missing Authorization gets 401", async () => {
    const res = await request(app).get(`/swimmers/${swimmerId}/score-history`);
    expect(res.status).toBe(401);
  });

  it("response never carries faultTags or faultTrends — faultTrends key must be absent, not empty", async () => {
    await clearSwimmerSessions();
    await seedRating({
      grade: 4,
      sessionDate: "2026-10-13",
      ratedAt: "2026-10-13T10:00:00.000Z",
      faultTags: ["breaks down 2nd length"],
    });

    const res = await request(app)
      .get(`/swimmers/${swimmerId}/score-history`)
      .set("Authorization", `Bearer ${owner.accessToken}`);
    expect(res.status).toBe(200);

    // Walk every nested object; no key may be exactly "faultTags" (per-point)
    // or "faultTrends" (top-level coach-only series).
    const serialized = JSON.stringify(res.body);
    expect(serialized.includes("faultTags")).toBe(false);
    expect(serialized.includes("faultTrends")).toBe(false);
    // Serialization-boundary invariant: the parent route runs the response
    // through ParentScoreHistoryResponseSchema.strict() which omits
    // faultTrends. The key must be ABSENT entirely, not just empty-array.
    expect(Object.prototype.hasOwnProperty.call(res.body, "faultTrends")).toBe(false);
  });

  it("response never carries sessionId — the key is coach-only (deep-links to the edit page)", async () => {
    await clearSwimmerSessions();
    // Two sessions on different dates so points, recentChanges, and
    // milestones all have something to carry.
    await seedRating({ grade: 2, sessionDate: "2026-10-10", ratedAt: "2026-10-10T10:00:00.000Z" });
    await seedRating({ grade: 4, sessionDate: "2026-10-13", ratedAt: "2026-10-13T10:00:00.000Z" });

    const res = await request(app)
      .get(`/swimmers/${swimmerId}/score-history`)
      .set("Authorization", `Bearer ${owner.accessToken}`);
    expect(res.status).toBe(200);

    // Nothing in the serialized response may contain "sessionId" — not in
    // points, not in recentChanges, not in milestones, not in measurements.
    // sessionId exists on the coach shape to deep-link charts to the coach
    // edit page (ADR 032); parents can't reach that page, so the key is
    // stripped at the parent serialization boundary.
    const serialized = JSON.stringify(res.body);
    expect(serialized.includes("sessionId")).toBe(false);

    // Belt-and-suspenders structural checks on each array.
    const points = res.body.points as Array<Record<string, unknown>>;
    expect(points.length).toBeGreaterThan(0);
    for (const point of points) {
      expect(Object.prototype.hasOwnProperty.call(point, "sessionId")).toBe(false);
    }
    for (const change of res.body.recentChanges as Array<Record<string, unknown>>) {
      expect(Object.prototype.hasOwnProperty.call(change, "sessionId")).toBe(false);
    }
    for (const milestone of res.body.milestones as Array<Record<string, unknown>>) {
      expect(Object.prototype.hasOwnProperty.call(milestone, "sessionId")).toBe(false);
    }
    for (const series of res.body.measurements as Array<{ points: Array<Record<string, unknown>> }>) {
      for (const measurementPoint of series.points) {
        expect(Object.prototype.hasOwnProperty.call(measurementPoint, "sessionId")).toBe(false);
      }
    }
  });

  it("voided ratings don't produce a point", async () => {
    await clearSwimmerSessions();
    await seedRating({ grade: 3, sessionDate: "2026-10-14", ratedAt: "2026-10-14T10:00:00.000Z" });
    const second = await seedRating({
      grade: 1,
      sessionDate: "2026-10-15",
      ratedAt: "2026-10-15T10:00:00.000Z",
    });

    // Void with the coach that wrote the rating — the void endpoint checks
    // the authenticated coach matches the rating's coach_id.
    const voidRes = await request(app)
      .patch(`/coach/ratings/${second.ratingId}/void`)
      .set("Authorization", `Bearer ${second.coach.accessToken}`)
      .send({ reason: "Err" });
    expect(voidRes.status).toBe(200);

    const res = await request(app)
      .get(`/swimmers/${swimmerId}/score-history`)
      .set("Authorization", `Bearer ${owner.accessToken}`);
    expect(res.status).toBe(200);
    const dates = (res.body.points as Array<{ sessionDate: string }>).map((point) => point.sessionDate);
    expect(dates).toEqual(["2026-10-14"]);
  });

  it("a swimmer with one evaluation returns exactly one point", async () => {
    await clearSwimmerSessions();
    await seedRating({ grade: 4, sessionDate: "2026-10-16", ratedAt: "2026-10-16T10:00:00.000Z" });

    const res = await request(app)
      .get(`/swimmers/${swimmerId}/score-history`)
      .set("Authorization", `Bearer ${owner.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.points).toHaveLength(1);
    expect(res.body.points[0].sessionDate).toBe("2026-10-16");
  });
});
