// Integration test for GET /coach/swimmers/:id/score-history.
// Requires a running local Supabase stack (pnpm db:up) with migrations applied.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import request from "supertest";
import pino from "pino";
import { createApp } from "../../app";
import { adminDb, closeAdminDb, createTestUser, hardDeleteSwimmer } from "./helpers";
import type { TestUser } from "./helpers";
import {
  evaluationSessions,
  meetSwims,
  meets,
  profiles,
  skillRatings,
  skills,
  swimmers,
} from "../../db/schema";
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
let freeHorizontalAlignmentSkillId: string;
let trackStartReactionSkillId: string;
let trackStartHeightSkillId: string;

async function cleanSwimmerData(swimmerId: string): Promise<void> {
  await adminDb().delete(skillRatings).where(eq(skillRatings.swimmerId, swimmerId));
  await adminDb().delete(evaluationSessions).where(eq(evaluationSessions.swimmerId, swimmerId));
  await adminDb().delete(meetSwims).where(eq(meetSwims.swimmerId, swimmerId));
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

  const alignmentRows = await adminDb()
    .select({ id: skills.id })
    .from(skills)
    .where(eq(skills.slug, "free-horizontal-alignment"))
    .limit(1);
  if (!alignmentRows[0]) throw new Error("free-horizontal-alignment missing — run pnpm db:sync-catalog");
  freeHorizontalAlignmentSkillId = alignmentRows[0].id;
});

afterAll(async () => {
  // Drop any meets this coach created during tests before deleting the
  // coach's profile — the meets.created_by FK blocks the profile delete.
  await adminDb().delete(meets).where(eq(meets.createdBy, coach.userId));
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

  it("counts rated skills at each level and tallies progression per date", async () => {
    const swimmerId = await createTestSwimmer();
    try {
      // Date 1: free-kick at 2 (one skill rated at level 2).
      await postSession(coach, swimmerId, "freestyle", "2026-10-01", [
        freshRating(freeKickSkillId, 2, "2026-10-01T10:00:00.000Z"),
      ]);
      // Date 2: free-kick upgraded to 5 (mastery). Starts: reaction=5.
      await postSession(coach, swimmerId, "freestyle", "2026-10-10", [
        freshRating(freeKickSkillId, 5, "2026-10-10T10:00:00.000Z"),
      ]);
      await postSession(coach, swimmerId, "starts", "2026-10-10", [
        freshRating(trackStartReactionSkillId, 5, "2026-10-10T10:05:00.000Z"),
      ]);

      const history = await getScoreHistory(coach, swimmerId);
      expect(history.points).toHaveLength(2);

      // Date 1: one skill at level 2 → counts.level2 = 1, nothing mastered,
      // nothing gained vs. baseline (first-ever grade is 2 itself), one skill
      // learned (baseline was absent before this session).
      const point1 = history.points[0]!;
      expect(point1.counts.level2).toBe(1);
      expect(point1.counts.level1).toBe(0);
      expect(point1.counts.level5).toBe(0);
      expect(point1.counts.notLegal).toBe(0);
      expect(point1.counts.noConcept).toBe(0);
      expect(point1.totalLevelsGained).toBe(0);
      expect(point1.skillsMastered).toBe(0);
      expect(point1.skillsLearned).toBe(1);

      // Date 2: free-kick is 5 (gained 5-2=3 levels, mastered); reaction is 5
      // (its own baseline is 5 so no gain; mastered). skillsLearned = 2.
      const point2 = history.points[1]!;
      expect(point2.counts.level5).toBe(2);
      expect(point2.counts.level2).toBe(0);
      expect(point2.totalLevelsGained).toBe(3);
      expect(point2.skillsMastered).toBe(2);
      expect(point2.skillsLearned).toBe(2);
    } finally {
      await cleanSwimmerData(swimmerId);
      await hardDeleteSwimmer(swimmerId);
    }
  });

  it("drops voided and superseded ratings from counts (progression tallies match live calculations)", async () => {
    const swimmerId = await createTestSwimmer();
    try {
      // Date 1: free-kick = 1 (should become the baseline).
      const date1 = await postSession(coach, swimmerId, "freestyle", "2026-10-01", [
        freshRating(freeKickSkillId, 1, "2026-10-01T10:00:00.000Z"),
      ]);
      // Date 2: a bad rating gets voided before anyone acts on it.
      const date2 = await postSession(coach, swimmerId, "freestyle", "2026-10-05", [
        freshRating(freeKickSkillId, 2, "2026-10-05T10:00:00.000Z"),
      ]);
      const voidRes = await request(app)
        .patch(`/coach/ratings/${date2.ratingIds[0]}/void`)
        .set("Authorization", `Bearer ${coach.accessToken}`)
        .send({ reason: "Not that rating" });
      expect(voidRes.status).toBe(200);
      // Date 3: a correction supersedes date 1's grade from 1 to 3.
      const sessionsRes = await request(app)
        .get(`/coach/sessions/${date1.sessionId}`)
        .set("Authorization", `Bearer ${coach.accessToken}`);
      expect(sessionsRes.status).toBe(200);
      const existingRating = (sessionsRes.body as { ratings: Array<{ ratingId: string }> }).ratings[0];
      const patchRes = await request(app)
        .patch(`/coach/sessions/${date1.sessionId}`)
        .set("Authorization", `Bearer ${coach.accessToken}`)
        .send({
          sessionDate: "2026-10-01",
          context: "practice",
          coachingPriority: "Focus",
          breathingPattern: "every_3",
          ratings: [
            {
              ratingId: existingRating!.ratingId,
              grade: 3,
              notLegal: false,
              noConcept: false,
              side: null,
              capacityValue: null,
              capacityUnit: null,
              measurementValue: null,
              measurementUnit: null,
              golfScoreCategory: null,
              note: null,
              faultTags: [],
            },
          ],
        });
      expect(patchRes.status).toBe(200);

      const history = await getScoreHistory(coach, swimmerId);
      // Date 2's rating was voided but no other ratings exist for that date,
      // so the whole date drops out. Date 1's effective grade is now the
      // correction (3) — the voided and superseded rows must not inflate
      // the level counts.
      expect(history.points.map((point) => point.sessionDate)).toEqual(["2026-10-01"]);
      const only = history.points[0]!;
      expect(only.counts.level1).toBe(0);
      expect(only.counts.level2).toBe(0);
      expect(only.counts.level3).toBe(1);
      // Baseline is the earliest effective grade (3 after correction); no gain.
      expect(only.totalLevelsGained).toBe(0);
      expect(only.skillsMastered).toBe(0);
      expect(only.skillsLearned).toBe(1);
    } finally {
      await cleanSwimmerData(swimmerId);
      await hardDeleteSwimmer(swimmerId);
    }
  });

  it("recentChanges reports the newest 20 effective-grade transitions with drops marked", async () => {
    const swimmerId = await createTestSwimmer();
    try {
      // Four freestyle sessions on the same free-kick skill:
      //   d1: 2 → first-ever rating, no change event.
      //   d2: 4 → level-up (2 → 4, direction=up).
      //   d3: 3 → drop (4 → 3, direction=down).
      //   d4: 3 → equal, no change event.
      await postSession(coach, swimmerId, "freestyle", "2026-10-01", [
        freshRating(freeKickSkillId, 2, "2026-10-01T10:00:00.000Z"),
      ]);
      await postSession(coach, swimmerId, "freestyle", "2026-10-05", [
        freshRating(freeKickSkillId, 4, "2026-10-05T10:00:00.000Z"),
      ]);
      await postSession(coach, swimmerId, "freestyle", "2026-10-10", [
        freshRating(freeKickSkillId, 3, "2026-10-10T10:00:00.000Z"),
      ]);
      await postSession(coach, swimmerId, "freestyle", "2026-10-15", [
        freshRating(freeKickSkillId, 3, "2026-10-15T10:00:00.000Z"),
      ]);

      const history = await getScoreHistory(coach, swimmerId);
      expect(history.recentChanges).toHaveLength(2);
      // Newest first.
      const [newest, older] = history.recentChanges;
      expect(newest!.sessionDate).toBe("2026-10-10");
      expect(newest!.fromGrade).toBe(4);
      expect(newest!.toGrade).toBe(3);
      expect(newest!.direction).toBe("down");
      expect(newest!.skillSlug).toBe("free-kick");
      expect(older!.sessionDate).toBe("2026-10-05");
      expect(older!.fromGrade).toBe(2);
      expect(older!.toGrade).toBe(4);
      expect(older!.direction).toBe("up");
    } finally {
      await cleanSwimmerData(swimmerId);
      await hardDeleteSwimmer(swimmerId);
    }
  });

  it("milestones detect each type: legal, learned, mastered, unlocked, personal best", async () => {
    const swimmerId = await createTestSwimmer();
    try {
      // d1: rate the prereq. free-horizontal-alignment is free-kick's declared
      // dependency, so this should emit skill_learned for it AND skill_unlocked
      // for free-kick (the gate opens even though free-kick isn't rated yet).
      await postSession(coach, swimmerId, "freestyle", "2026-10-01", [
        freshRating(freeHorizontalAlignmentSkillId, 3, "2026-10-01T10:00:00.000Z"),
      ]);
      // d2: rate free-kick as not_legal (phantom grade=1 required by the
      // not_legal_requires_grade check constraint). No milestones emit here —
      // not_legal isn't "learned" and we need a later numeric to produce legal.
      await postSession(coach, swimmerId, "freestyle", "2026-10-05", [
        {
          skillId: freeKickSkillId,
          grade: 1,
          notLegal: true,
          noConcept: false,
          side: null,
          capacityValue: null,
          capacityUnit: null,
          measurementValue: null,
          measurementUnit: null,
          note: null,
          faultTags: [],
          ratedAt: "2026-10-05T10:00:00.000Z",
        },
      ]);
      // d3: rate free-kick at 3 — emits both skill_legal (previously not_legal)
      // and skill_learned (first numeric).
      await postSession(coach, swimmerId, "freestyle", "2026-10-10", [
        freshRating(freeKickSkillId, 3, "2026-10-10T10:00:00.000Z"),
      ]);
      // d4: rate free-kick at 5 — emits skill_mastered.
      await postSession(coach, swimmerId, "freestyle", "2026-10-15", [
        freshRating(freeKickSkillId, 5, "2026-10-15T10:00:00.000Z"),
      ]);

      // Seed meet swims directly: two swims in the same event (50 free scy).
      // 32.00s → PB (first-ever time). 30.00s on a later date → faster PB.
      // A 33.00s swim in between is slower than the current PB and must not emit.
      const meetRows = await adminDb()
        .insert(meets)
        .values({
          name: "Winter Classic",
          meetDate: "2026-11-01",
          course: "scy",
          createdBy: coach.userId,
        })
        .returning({ id: meets.id });
      const meetId = meetRows[0]!.id;
      await adminDb().insert(meetSwims).values([
        {
          swimmerId,
          meetId,
          swimType: "meet",
          eventDistance: 50,
          eventStroke: "free",
          course: "scy",
          swumOn: "2026-11-01",
          timeHundredths: 3200,
          createdBy: coach.userId,
        },
        {
          swimmerId,
          meetId,
          swimType: "meet",
          eventDistance: 50,
          eventStroke: "free",
          course: "scy",
          swumOn: "2026-11-05",
          timeHundredths: 3300,
          createdBy: coach.userId,
        },
        {
          swimmerId,
          meetId,
          swimType: "meet",
          eventDistance: 50,
          eventStroke: "free",
          course: "scy",
          swumOn: "2026-11-10",
          timeHundredths: 3000,
          createdBy: coach.userId,
        },
      ]);

      const history = await getScoreHistory(coach, swimmerId);
      const kickLearned = history.milestones.filter(
        (milestone) => milestone.type === "skill_learned" && milestone.skillSlug === "free-kick",
      );
      const kickLegal = history.milestones.filter(
        (milestone) => milestone.type === "skill_legal" && milestone.skillSlug === "free-kick",
      );
      const kickMastered = history.milestones.filter(
        (milestone) => milestone.type === "skill_mastered" && milestone.skillSlug === "free-kick",
      );
      const kickUnlocked = history.milestones.filter(
        (milestone) => milestone.type === "skill_unlocked" && milestone.skillSlug === "free-kick",
      );
      expect(kickLearned).toHaveLength(1);
      expect(kickLearned[0]!.sessionDate).toBe("2026-10-10");
      expect(kickLegal).toHaveLength(1);
      expect(kickLegal[0]!.sessionDate).toBe("2026-10-10");
      expect(kickMastered).toHaveLength(1);
      expect(kickMastered[0]!.sessionDate).toBe("2026-10-15");
      expect(kickUnlocked).toHaveLength(1);
      expect(kickUnlocked[0]!.sessionDate).toBe("2026-10-01");

      const pbs = history.milestones.filter((milestone) => milestone.type === "personal_best");
      expect(pbs).toHaveLength(2);
      // Newest first.
      expect(pbs[0]!.sessionDate).toBe("2026-11-10");
      expect(pbs[0]!.type === "personal_best" && pbs[0]!.timeHundredths).toBe(3000);
      expect(pbs[1]!.sessionDate).toBe("2026-11-01");
      expect(pbs[1]!.type === "personal_best" && pbs[1]!.timeHundredths).toBe(3200);

      // Overall ordering: newest first.
      const dates = history.milestones.map((milestone) => milestone.sessionDate);
      const sorted = [...dates].sort().reverse();
      expect(dates).toEqual(sorted);
    } finally {
      await cleanSwimmerData(swimmerId);
      await hardDeleteSwimmer(swimmerId);
    }
  });

  it("coach fault trends count tagged ratings per date and parent response hides them", async () => {
    const swimmerId = await createTestSwimmer();
    try {
      // d1: two free-kick ratings on the same date, both tagged with the same
      // declared fault — count=2 for that date.
      await postSession(coach, swimmerId, "freestyle", "2026-10-20", [
        {
          skillId: freeKickSkillId,
          grade: 2,
          notLegal: false,
          noConcept: false,
          side: null,
          capacityValue: null,
          capacityUnit: null,
          measurementValue: null,
          measurementUnit: null,
          note: null,
          faultTags: ["breaks down 2nd length"],
          ratedAt: "2026-10-20T10:00:00.000Z",
        },
      ]);
      // d2: one rating, no faults — count=0.
      await postSession(coach, swimmerId, "freestyle", "2026-10-25", [
        freshRating(freeKickSkillId, 3, "2026-10-25T10:00:00.000Z"),
      ]);
      // d3: tagged again — count=1.
      await postSession(coach, swimmerId, "freestyle", "2026-10-28", [
        {
          skillId: freeKickSkillId,
          grade: 2,
          notLegal: false,
          noConcept: false,
          side: null,
          capacityValue: null,
          capacityUnit: null,
          measurementValue: null,
          measurementUnit: null,
          note: null,
          faultTags: ["breaks down 2nd length"],
          ratedAt: "2026-10-28T10:00:00.000Z",
        },
      ]);

      const history = await getScoreHistory(coach, swimmerId);
      expect(history.faultTrends).toHaveLength(1);
      const trend = history.faultTrends[0]!;
      expect(trend.faultTag).toBe("breaks down 2nd length");
      // Each session date in the window gets a point; counts include zeros so
      // the UI can show the tag going quiet.
      const byDate = new Map(trend.points.map((point) => [point.sessionDate, point.count]));
      expect(byDate.get("2026-10-20")).toBe(1);
      expect(byDate.get("2026-10-25")).toBe(0);
      expect(byDate.get("2026-10-28")).toBe(1);
    } finally {
      await cleanSwimmerData(swimmerId);
      await hardDeleteSwimmer(swimmerId);
    }
  });

  it("measurements series carry per-skill values in order with higher/lower-better direction", async () => {
    const swimmerId = await createTestSwimmer();
    try {
      const tempoRows = await adminDb()
        .select({ id: skills.id })
        .from(skills)
        .where(eq(skills.slug, "free-tempo"))
        .limit(1);
      if (!tempoRows[0]) throw new Error("free-tempo missing — run pnpm db:sync-catalog");
      const freeTempoSkillId = tempoRows[0].id;

      // Two rated tempos on two dates — ascending time series, higher = better.
      await postSession(coach, swimmerId, "freestyle", "2026-10-01", [
        {
          skillId: freeTempoSkillId,
          grade: 3,
          notLegal: false,
          noConcept: false,
          side: null,
          capacityValue: null,
          capacityUnit: null,
          measurementValue: "48",
          measurementUnit: "stroke_cycles_per_minute",
          note: null,
          faultTags: [],
          ratedAt: "2026-10-01T10:00:00.000Z",
        },
      ]);
      await postSession(coach, swimmerId, "freestyle", "2026-10-10", [
        {
          skillId: freeTempoSkillId,
          grade: 4,
          notLegal: false,
          noConcept: false,
          side: null,
          capacityValue: null,
          capacityUnit: null,
          measurementValue: "54",
          measurementUnit: "stroke_cycles_per_minute",
          note: null,
          faultTags: [],
          ratedAt: "2026-10-10T10:00:00.000Z",
        },
      ]);

      const history = await getScoreHistory(coach, swimmerId);
      const tempo = history.measurements.find((series) => series.skillSlug === "free-tempo");
      expect(tempo).toBeDefined();
      expect(tempo!.unit).toBe("stroke_cycles_per_minute");
      expect(tempo!.direction).toBe("higher_better");
      expect(tempo!.points.map((point) => ({ date: point.sessionDate, value: point.value }))).toEqual([
        { date: "2026-10-01", value: 48 },
        { date: "2026-10-10", value: 54 },
      ]);
    } finally {
      await cleanSwimmerData(swimmerId);
      await hardDeleteSwimmer(swimmerId);
    }
  });

  it("milestones, measurements, recentChanges and faultTrends are all empty for a swimmer with no ratings or meet swims", async () => {
    const swimmerId = await createTestSwimmer();
    try {
      const history = await getScoreHistory(coach, swimmerId);
      expect(history.milestones).toEqual([]);
      expect(history.measurements).toEqual([]);
      expect(history.recentChanges).toEqual([]);
      expect(history.faultTrends).toEqual([]);
      expect(history.points).toEqual([]);
    } finally {
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
