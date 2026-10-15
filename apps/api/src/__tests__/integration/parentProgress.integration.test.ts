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
let categoryId: string;

beforeAll(async () => {
  await syncCatalogFn(adminDb());

  owner = await createTestUser("parent-progress-owner");

  // Lookup a real skill
  const skillRows = await adminDb()
    .select({ id: skills.id, categoryId: skills.categoryId })
    .from(skills)
    .where(eq(skills.slug, "free-kick"))
    .limit(1);
  if (!skillRows[0]) throw new Error("free-kick skill not found");
  skillId = skillRows[0].id;
  categoryId = skillRows[0].categoryId;

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
        categoryId,
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
            faultTags: ["flat-kick", "crossover"],
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

  it("voided ratings excluded", async () => {
    const coach = await createTestUser("parent-progress-coach-void");
    await adminDb().update(profiles).set({ role: "coach" }).where(eq(profiles.id, coach.userId));

    const session1 = await request(app)
      .post(`/coach/swimmers/${swimmerId}/sessions`)
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send({
        categoryId,
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
        categoryId,
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
