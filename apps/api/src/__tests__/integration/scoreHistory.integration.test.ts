// Integration test for GET /coach/swimmers/:id/score-history.
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
import type { ScoreHistoryResponse, SwimmerProgressResponse } from "@swim-app/shared";

const logger = pino({ level: "silent" });
const app = createApp(logger);

type RatingBody = {
  skillId: string;
  grade: number | null;
  notLegal: boolean;
  noConcept: boolean;
  side: "left" | "right" | null;
  capacityValue: string | null;
  capacityUnit: "yards" | "reps" | null;
  measurementValue: string | null;
  measurementUnit: "stroke_cycles_per_minute" | "stroke_count" | "seconds" | "feet" | null;
  note: string | null;
  faultTags: string[];
  ratedAt: string;
};

async function postSession(
  coach: TestUser,
  swimmerId: string,
  screenSlug: string,
  sessionDate: string,
  ratings: RatingBody[],
  options: { breathingPattern?: "every_1" | "every_2" | "every_3" | "every_4" | "every_5" | "other" | null } = {},
): Promise<{ sessionId: string; ratingIds: string[] }> {
  const breathingPattern = options.breathingPattern ?? (screenSlug === "freestyle" ? "every_3" : null);
  const res = await request(app)
    .post(`/coach/swimmers/${swimmerId}/sessions`)
    .set("Authorization", `Bearer ${coach.accessToken}`)
    .send({
      screenSlug,
      breathingPattern,
      sessionDate,
      context: "practice",
      coachingPriority: "Focus",
      ratings,
    });
  if (res.status !== 201) {
    throw new Error(`Session create failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return res.body as { sessionId: string; ratingIds: string[] };
}

async function getProgress(
  coach: TestUser,
  swimmerId: string,
): Promise<SwimmerProgressResponse> {
  const res = await request(app)
    .get(`/coach/swimmers/${swimmerId}/progress`)
    .set("Authorization", `Bearer ${coach.accessToken}`);
  if (res.status !== 200) {
    throw new Error(`Progress fetch failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return res.body as SwimmerProgressResponse;
}

async function getScoreHistory(
  coach: TestUser,
  swimmerId: string,
): Promise<ScoreHistoryResponse> {
  const res = await request(app)
    .get(`/coach/swimmers/${swimmerId}/score-history`)
    .set("Authorization", `Bearer ${coach.accessToken}`);
  if (res.status !== 200) {
    throw new Error(`Score history fetch failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return res.body as ScoreHistoryResponse;
}

function freshRating(skillId: string, grade: number, ratedAt: string): RatingBody {
  return {
    skillId,
    grade,
    notLegal: false,
    noConcept: false,
    side: null,
    capacityValue: null,
    capacityUnit: null,
    measurementValue: null,
    measurementUnit: null,
    note: null,
    faultTags: [],
    ratedAt,
  };
}

let coach: TestUser;
let freeKickSkillId: string;
let trackStartReactionSkillId: string;
let trackStartHeightSkillId: string;

async function cleanSwimmerData(swimmerId: string): Promise<void> {
  await adminDb().delete(skillRatings).where(eq(skillRatings.swimmerId, swimmerId));
  await adminDb().delete(evaluationSessions).where(eq(evaluationSessions.swimmerId, swimmerId));
}

async function createTestSwimmer(): Promise<string> {
  const rows = await adminDb()
    .insert(swimmers)
    .values({
      firstName: "ScoreHistory",
      lastName: "Testswimmer",
      birthDate: "2015-01-01",
      sex: "female",
      isPublic: false,
      householdId: coach.householdId,
    })
    .returning({ id: swimmers.id });
  return rows[0]!.id;
}

beforeAll(async () => {
  await syncCatalogFn(adminDb());

  coach = await createTestUser("score-history-int");
  await adminDb().update(profiles).set({ role: "coach" }).where(eq(profiles.id, coach.userId));

  const freeKickRows = await adminDb()
    .select({ id: skills.id })
    .from(skills)
    .where(eq(skills.slug, "free-kick"))
    .limit(1);
  if (!freeKickRows[0]) throw new Error("free-kick missing — run pnpm db:sync-catalog");
  freeKickSkillId = freeKickRows[0].id;

  const reactionRows = await adminDb()
    .select({ id: skills.id })
    .from(skills)
    .where(eq(skills.slug, "track-start-reaction"))
    .limit(1);
  if (!reactionRows[0]) throw new Error("track-start-reaction missing — run pnpm db:sync-catalog");
  trackStartReactionSkillId = reactionRows[0].id;

  const heightRows = await adminDb()
    .select({ id: skills.id })
    .from(skills)
    .where(eq(skills.slug, "track-start-height"))
    .limit(1);
  if (!heightRows[0]) throw new Error("track-start-height missing — run pnpm db:sync-catalog");
  trackStartHeightSkillId = heightRows[0].id;
});

afterAll(async () => {
  await coach.cleanup();
  await closeAdminDb();
});

describe("GET /coach/swimmers/:id/score-history", () => {
  it("returns one point per non-voided evaluation date", async () => {
    const swimmerId = await createTestSwimmer();
    try {
      await postSession(coach, swimmerId, "freestyle", "2026-10-01", [
        freshRating(freeKickSkillId, 2, "2026-10-01T10:00:00.000Z"),
      ]);
      await postSession(coach, swimmerId, "freestyle", "2026-10-05", [
        freshRating(freeKickSkillId, 4, "2026-10-05T10:00:00.000Z"),
      ]);

      const history = await getScoreHistory(coach, swimmerId);
      expect(history.points.map((point) => point.sessionDate)).toEqual([
        "2026-10-01",
        "2026-10-05",
      ]);
    } finally {
      await cleanSwimmerData(swimmerId);
      await hardDeleteSwimmer(swimmerId);
    }
  });

  it("values at each date match the current calculation when only those evaluations exist", async () => {
    const swimmerId = await createTestSwimmer();
    try {
      // Session 1: a freestyle skill + 2 track-start components.
      await postSession(coach, swimmerId, "freestyle", "2026-10-01", [
        freshRating(freeKickSkillId, 2, "2026-10-01T10:00:00.000Z"),
      ]);
      await postSession(coach, swimmerId, "starts", "2026-10-01", [
        freshRating(trackStartReactionSkillId, 3, "2026-10-01T10:05:00.000Z"),
        freshRating(trackStartHeightSkillId, 3, "2026-10-01T10:06:00.000Z"),
      ]);
      const progressAfterDate1 = await getProgress(coach, swimmerId);

      // Session 2: upgrade free-kick, add a different track-start component rating.
      await postSession(coach, swimmerId, "freestyle", "2026-10-10", [
        freshRating(freeKickSkillId, 5, "2026-10-10T10:00:00.000Z"),
      ]);
      await postSession(coach, swimmerId, "starts", "2026-10-10", [
        freshRating(trackStartReactionSkillId, 5, "2026-10-10T10:05:00.000Z"),
      ]);
      const progressAfterDate2 = await getProgress(coach, swimmerId);

      const history = await getScoreHistory(coach, swimmerId);
      expect(history.points).toHaveLength(2);

      const point1 = history.points[0]!;
      expect(point1.sessionDate).toBe("2026-10-01");
      expect(point1.headPositionOverall).toBe(progressAfterDate1.headPositionOverall);
      for (const start of progressAfterDate1.startProgress) {
        const historyStart = point1.starts.find((entry) => entry.slug === start.slug);
        expect(historyStart, `score-history must include start ${start.slug} at date 1`).toBeDefined();
        expect(historyStart!.grade).toEqual(start.grade);
      }

      const point2 = history.points[1]!;
      expect(point2.sessionDate).toBe("2026-10-10");
      expect(point2.headPositionOverall).toBe(progressAfterDate2.headPositionOverall);
      for (const start of progressAfterDate2.startProgress) {
        const historyStart = point2.starts.find((entry) => entry.slug === start.slug);
        expect(historyStart, `score-history must include start ${start.slug} at date 2`).toBeDefined();
        expect(historyStart!.grade).toEqual(start.grade);
      }

      // Category rollup for freestyle at date 1: only free-kick=2 assessed → avg = 2.
      // At date 2: free-kick=5 (latest, grade-2 is historical) → avg = 5.
      const freestyleAtDate1 = point1.categoryRollups.find((rollup) => rollup.categorySlug === "freestyle");
      expect(freestyleAtDate1).toBeDefined();
      expect(freestyleAtDate1!.assessedCount).toBe(1);
      expect(freestyleAtDate1!.average).toBe(2);

      const freestyleAtDate2 = point2.categoryRollups.find((rollup) => rollup.categorySlug === "freestyle");
      expect(freestyleAtDate2).toBeDefined();
      expect(freestyleAtDate2!.assessedCount).toBe(1);
      expect(freestyleAtDate2!.average).toBe(5);
    } finally {
      await cleanSwimmerData(swimmerId);
      await hardDeleteSwimmer(swimmerId);
    }
  });

  it("a voided session changes the history", async () => {
    const swimmerId = await createTestSwimmer();
    try {
      await postSession(coach, swimmerId, "freestyle", "2026-10-01", [
        freshRating(freeKickSkillId, 2, "2026-10-01T10:00:00.000Z"),
      ]);
      const date2Response = await postSession(coach, swimmerId, "freestyle", "2026-10-05", [
        freshRating(freeKickSkillId, 4, "2026-10-05T10:00:00.000Z"),
      ]);

      const beforeVoid = await getScoreHistory(coach, swimmerId);
      expect(beforeVoid.points).toHaveLength(2);
      expect(beforeVoid.points[1]!.categoryRollups.find((rollup) => rollup.categorySlug === "freestyle")!.average).toBe(4);

      const voidRes = await request(app)
        .patch(`/coach/ratings/${date2Response.ratingIds[0]}/void`)
        .set("Authorization", `Bearer ${coach.accessToken}`)
        .send({ reason: "Data entry error" });
      expect(voidRes.status).toBe(200);

      const afterVoid = await getScoreHistory(coach, swimmerId);
      // The second session had its only rating voided — that session date must
      // drop out entirely, and the surviving point reflects only the first rating.
      expect(afterVoid.points.map((point) => point.sessionDate)).toEqual(["2026-10-01"]);
      expect(afterVoid.points[0]!.categoryRollups.find((rollup) => rollup.categorySlug === "freestyle")!.average).toBe(2);
    } finally {
      await cleanSwimmerData(swimmerId);
      await hardDeleteSwimmer(swimmerId);
    }
  });

  it("a swimmer with one evaluation returns one point", async () => {
    const swimmerId = await createTestSwimmer();
    try {
      await postSession(coach, swimmerId, "freestyle", "2026-10-01", [
        freshRating(freeKickSkillId, 3, "2026-10-01T10:00:00.000Z"),
      ]);

      const history = await getScoreHistory(coach, swimmerId);
      expect(history.points).toHaveLength(1);
      expect(history.points[0]!.sessionDate).toBe("2026-10-01");
      expect(history.points[0]!.categoryRollups.find((rollup) => rollup.categorySlug === "freestyle")!.average).toBe(3);
    } finally {
      await cleanSwimmerData(swimmerId);
      await hardDeleteSwimmer(swimmerId);
    }
  });

  it("reports response time for a swimmer with 30 evaluations", async () => {
    const swimmerId = await createTestSwimmer();
    try {
      // 30 sessions on 30 distinct dates with one rating each.
      for (let dayIndex = 0; dayIndex < 30; dayIndex++) {
        const day = String(dayIndex + 1).padStart(2, "0");
        const date = `2026-09-${day}`;
        const grade = ((dayIndex % 5) + 1) as 1 | 2 | 3 | 4 | 5;
        await postSession(coach, swimmerId, "freestyle", date, [
          freshRating(freeKickSkillId, grade, `${date}T10:00:00.000Z`),
        ]);
      }

      const started = performance.now();
      const history = await getScoreHistory(coach, swimmerId);
      const elapsedMs = performance.now() - started;

      expect(history.points).toHaveLength(30);
      process.stdout.write(`[score-history] 30-evaluation response time: ${elapsedMs.toFixed(1)} ms\n`);
    } finally {
      await cleanSwimmerData(swimmerId);
      await hardDeleteSwimmer(swimmerId);
    }
  });
});
