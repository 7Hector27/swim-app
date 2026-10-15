// Integration test for GET /coach/swimmers/:id/progress — voided ratings.
// Requires a running local Supabase stack (pnpm db:up) with migrations applied.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import request from "supertest";
import pino from "pino";
import { createApp } from "../../app";
import { adminDb, closeAdminDb, createTestUser, hardDeleteSwimmer } from "./helpers";
import type { TestUser } from "./helpers";
import { evaluationSessions, profiles, skillRatings, skills, swimmers } from "../../db/schema";
import syncCatalogFn from "../../db/scripts/syncCatalogFn";

const logger = pino({ level: "silent" });
const app = createApp(logger);

let coach: TestUser;
let swimmerId: string;
let categoryId: string;
let skillId: string;

beforeAll(async () => {
  await syncCatalogFn(adminDb());

  coach = await createTestUser("progress-int");

  await adminDb().update(profiles).set({ role: "coach" }).where(eq(profiles.id, coach.userId));

  const skillRows = await adminDb()
    .select({ id: skills.id, categoryId: skills.categoryId })
    .from(skills)
    .where(eq(skills.slug, "free-kick"))
    .limit(1);
  if (!skillRows[0]) throw new Error("Catalog skill free-kick not found — run pnpm db:sync-catalog");
  skillId = skillRows[0].id;
  categoryId = skillRows[0].categoryId;

  const swimmerRows = await adminDb()
    .insert(swimmers)
    .values({
      firstName: "Progress",
      lastName: "Testswimmer",
      birthDate: "2015-01-01",
      sex: "female",
      isPublic: false,
      householdId: coach.householdId,
    })
    .returning({ id: swimmers.id });
  swimmerId = swimmerRows[0]!.id;
});

afterAll(async () => {
  await adminDb().delete(skillRatings).where(eq(skillRatings.swimmerId, swimmerId));
  await adminDb().delete(evaluationSessions).where(eq(evaluationSessions.swimmerId, swimmerId));
  await hardDeleteSwimmer(swimmerId);
  await coach.cleanup();
  await closeAdminDb();
});

describe("GET /coach/swimmers/:id/progress — voided ratings excluded", () => {
  it("excludes a voided rating from history and uses only the non-voided rating for current level", async () => {
    // Create session with two ratings for the same skill: grade 4 first, then grade 2.
    const sessionRes = await request(app)
      .post(`/coach/swimmers/${swimmerId}/sessions`)
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send({
        categoryId,
        sessionDate: "2026-10-01",
        context: "practice",
        coachingPriority: "Head position",
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
            ratedAt: "2026-10-01T10:00:00.000Z",
          },
          {
            skillId,
            grade: 2,
            notLegal: false,
            noConcept: false,
            side: null,
            capacityValue: null,
            capacityUnit: null,
            measurementValue: null,
            measurementUnit: null,
            note: null,
            faultTags: [],
            ratedAt: "2026-10-01T11:00:00.000Z",
          },
        ],
      });
    expect(sessionRes.status).toBe(201);

    const { ratingIds } = sessionRes.body as { ratingIds: string[] };
    expect(ratingIds).toHaveLength(2);

    // Void the grade-2 rating (newer one, at index 1 by ratedAt order — but ratingIds order matches input order)
    // ratingIds[0] = grade 4, ratingIds[1] = grade 2
    const voidRes = await request(app)
      .patch(`/coach/ratings/${ratingIds[1]}/void`)
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send({ reason: "Data entry error" });
    expect(voidRes.status).toBe(200);

    // GET progress — voided rating must be absent
    const progressRes = await request(app)
      .get(`/coach/swimmers/${swimmerId}/progress`)
      .set("Authorization", `Bearer ${coach.accessToken}`);
    expect(progressRes.status).toBe(200);

    const matchingSkill = progressRes.body.skills.find(
      (s: { skillId: string }) => s.skillId === skillId,
    );
    expect(matchingSkill).toBeDefined();

    // Only the grade-4 (non-voided) rating should appear in history
    expect(matchingSkill.history).toHaveLength(1);
    expect(matchingSkill.history[0].grade).toBe(4);
    expect(matchingSkill.history[0].id).toBe(ratingIds[0]);

    // Current level should reflect grade 4, not grade 2
    expect(matchingSkill.current.grade).toBe(4);
  });
});
