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
let skillId: string;
let startComponentSkillId: string;

beforeAll(async () => {
  await syncCatalogFn(adminDb());

  coach = await createTestUser("progress-int");

  await adminDb().update(profiles).set({ role: "coach" }).where(eq(profiles.id, coach.userId));

  const skillRows = await adminDb()
    .select({ id: skills.id })
    .from(skills)
    .where(eq(skills.slug, "free-kick"))
    .limit(1);
  if (!skillRows[0]) throw new Error("Catalog skill free-kick not found — run pnpm db:sync-catalog");
  skillId = skillRows[0].id;

  const compRows = await adminDb()
    .select({ id: skills.id })
    .from(skills)
    .where(eq(skills.slug, "track-start-reaction"))
    .limit(1);
  if (!compRows[0]) throw new Error("Catalog skill track-start-reaction not found — run pnpm db:sync-catalog");
  startComponentSkillId = compRows[0].id;

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
    // Session 1: grade 4 on 2026-10-01
    const session1Res = await request(app)
      .post(`/coach/swimmers/${swimmerId}/sessions`)
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send({
        screenSlug: "freestyle",
        breathingPattern: "every_3",
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
        ],
      });
    expect(session1Res.status).toBe(201);
    const { ratingIds: ratingIds1 } = session1Res.body as { ratingIds: string[] };
    expect(ratingIds1).toHaveLength(1);

    // Session 2: grade 2 on 2026-10-01 (later ratedAt) — will be voided
    const session2Res = await request(app)
      .post(`/coach/swimmers/${swimmerId}/sessions`)
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send({
        screenSlug: "freestyle",
        breathingPattern: "every_3",
        sessionDate: "2026-10-01",
        context: "practice",
        coachingPriority: "Head position",
        ratings: [
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
    expect(session2Res.status).toBe(201);
    const { ratingIds: ratingIds2 } = session2Res.body as { ratingIds: string[] };
    expect(ratingIds2).toHaveLength(1);

    // Void the grade-2 rating from session 2
    const voidRes = await request(app)
      .patch(`/coach/ratings/${ratingIds2[0]}/void`)
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
    expect(matchingSkill.history[0].id).toBe(ratingIds1[0]);

    // Current level should reflect grade 4, not grade 2
    expect(matchingSkill.current.grade).toBe(4);
  });

  it("start component current level uses the latest rating when rated twice", async () => {
    // First session: rate track-start-reaction at grade 2 (earlier ratedAt)
    const session1Res = await request(app)
      .post(`/coach/swimmers/${swimmerId}/sessions`)
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send({
        screenSlug: "starts",
        breathingPattern: null,
        sessionDate: "2026-10-02",
        context: "practice",
        coachingPriority: "Reaction time",
        ratings: [
          {
            skillId: startComponentSkillId,
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
            ratedAt: "2026-10-02T09:00:00.000Z",
          },
        ],
      });
    expect(session1Res.status).toBe(201);

    // Second session: rate the same component at grade 4 (later ratedAt)
    const session2Res = await request(app)
      .post(`/coach/swimmers/${swimmerId}/sessions`)
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send({
        screenSlug: "starts",
        breathingPattern: null,
        sessionDate: "2026-10-03",
        context: "practice",
        coachingPriority: "Reaction time",
        ratings: [
          {
            skillId: startComponentSkillId,
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
            ratedAt: "2026-10-03T09:00:00.000Z",
          },
        ],
      });
    expect(session2Res.status).toBe(201);

    const progressRes = await request(app)
      .get(`/coach/swimmers/${swimmerId}/progress`)
      .set("Authorization", `Bearer ${coach.accessToken}`);
    expect(progressRes.status).toBe(200);

    const trackStart = progressRes.body.startProgress.find(
      (s: { slug: string }) => s.slug === "track-start",
    );
    expect(trackStart).toBeDefined();

    const reactionComp = trackStart.components.find(
      (c: { slug: string }) => c.slug === "track-start-reaction",
    );
    expect(reactionComp).toBeDefined();
    // Latest rating (grade 4) must win, not the earlier one (grade 2)
    expect(reactionComp.current).not.toBeNull();
    expect(reactionComp.current.grade).toBe(4);
  });
});

describe("GET /coach/swimmers/:id/progress — screen-based sessions", () => {
  it("ratings from a screen-based session appear in skills and coachingPriorities", async () => {
    const sessionRes = await request(app)
      .post(`/coach/swimmers/${swimmerId}/sessions`)
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send({
        screenSlug: "freestyle",
        breathingPattern: "every_3",
        sessionDate: "2026-10-10",
        context: "practice",
        coachingPriority: "Improve kick",
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

    const progressRes = await request(app)
      .get(`/coach/swimmers/${swimmerId}/progress`)
      .set("Authorization", `Bearer ${coach.accessToken}`);
    expect(progressRes.status).toBe(200);

    const matchingSkill = progressRes.body.skills.find(
      (s: { skillId: string }) => s.skillId === skillId,
    );
    expect(matchingSkill, "skill from screen-based session should appear in progress").toBeDefined();
    expect(matchingSkill.current.grade).toBe(3);

    const coachingPriorities = progressRes.body.coachingPriorities as Array<{ targetSlug: string }>;
    expect(Array.isArray(coachingPriorities)).toBe(true);
  });
});
