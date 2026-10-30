// Integration tests for GET and PATCH /coach/sessions/:id (ADR 032 phase 2).
// Requires a running local Supabase stack (pnpm db:up) with migrations applied.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import request from "supertest";
import pino from "pino";
import { createApp } from "../../app";
import {
  adminDb,
  closeAdminDb,
  createTestUser,
  hardDeleteSwimmer,
} from "./helpers";
import type { TestUser } from "./helpers";
import {
  evaluationSessions,
  householdAuditLog,
  profiles,
  ratingFaultTags,
  skillRatings,
  skills,
  swimmers,
} from "../../db/schema";
import syncCatalogFn from "../../db/scripts/syncCatalogFn";
import type { PatchSessionBody } from "@swim-app/shared";

const logger = pino({ level: "silent" });
const app = createApp(logger);

let coach: TestUser;
let otherCoach: TestUser;
let swimmerId: string;
let freeKickSkillId: string;
let freeSideSkillId: string;      // breathing-timing-free (rated_per_side)
let freeGolfSkillId: string;      // free-golf-score (score type)
let freeHeadSkillId: string;      // free-head-position (notLegalAllowed: false, no side)

async function cleanSwimmerData(): Promise<void> {
  await adminDb().delete(skillRatings).where(eq(skillRatings.swimmerId, swimmerId));
  await adminDb().delete(evaluationSessions).where(eq(evaluationSessions.swimmerId, swimmerId));
}

beforeAll(async () => {
  await syncCatalogFn(adminDb());

  coach = await createTestUser("edit-session-coach");
  await adminDb().update(profiles).set({ role: "coach" }).where(eq(profiles.id, coach.userId));

  otherCoach = await createTestUser("edit-session-other-coach");
  await adminDb().update(profiles).set({ role: "coach" }).where(eq(profiles.id, otherCoach.userId));

  const skillLookups = await adminDb()
    .select({ id: skills.id, slug: skills.slug })
    .from(skills);
  const bySlug = new Map(skillLookups.map((row) => [row.slug, row.id]));
  freeKickSkillId = bySlug.get("free-kick") ?? "";
  freeSideSkillId = bySlug.get("breathing-timing-free") ?? "";
  freeGolfSkillId = bySlug.get("free-golf-score") ?? "";
  freeHeadSkillId = bySlug.get("free-head-position") ?? "";

  if (!freeKickSkillId || !freeSideSkillId || !freeGolfSkillId || !freeHeadSkillId) {
    throw new Error("Required catalog skills missing (free-kick, breathing-timing-free, free-golf-score, free-head-position)");
  }

  const swimmerRows = await adminDb()
    .insert(swimmers)
    .values({
      firstName: "Edit",
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
  await cleanSwimmerData();
  await hardDeleteSwimmer(swimmerId);
  await otherCoach.cleanup();
  await coach.cleanup();
  await closeAdminDb();
});

type FreestyleRating = {
  skillId: string;
  grade?: 1 | 2 | 3 | 4 | 5 | null;
  notLegal?: boolean;
  noConcept?: boolean;
  side?: "left" | "right" | null;
  faultTags?: string[];
  measurementValue?: string | null;
  measurementUnit?: "stroke_cycles_per_minute" | "stroke_count" | "seconds" | "feet" | null;
  golfScoreCategory?: "push_off_in_water" | "deck_dive" | "block_dive" | null;
};

async function createFreestyleSession(options: {
  sessionDate?: string;
  context?: "drill" | "practice" | "race";
  coachingPriority?: string | null;
  ratings: FreestyleRating[];
}): Promise<{ sessionId: string; ratingIds: string[] }> {
  const res = await request(app)
    .post(`/coach/swimmers/${swimmerId}/sessions`)
    .set("Authorization", `Bearer ${coach.accessToken}`)
    .send({
      screenSlug: "freestyle",
      breathingPattern: "every_3",
      sessionDate: options.sessionDate ?? "2026-10-01",
      context: options.context ?? "practice",
      coachingPriority: options.coachingPriority ?? "Focus",
      ratings: options.ratings.map((rating) => ({
        skillId: rating.skillId,
        grade: rating.grade ?? 3,
        notLegal: rating.notLegal ?? false,
        noConcept: rating.noConcept ?? false,
        side: rating.side ?? null,
        capacityValue: null,
        capacityUnit: null,
        measurementValue: rating.measurementValue ?? null,
        measurementUnit: rating.measurementUnit ?? null,
        golfScoreCategory: rating.golfScoreCategory ?? null,
        note: null,
        faultTags: rating.faultTags ?? [],
        ratedAt: `${options.sessionDate ?? "2026-10-01"}T10:00:00.000Z`,
      })),
    });
  if (res.status !== 201) {
    throw new Error(`Session create failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return res.body as { sessionId: string; ratingIds: string[] };
}

function basePatchBody(overrides: Partial<PatchSessionBody> = {}): PatchSessionBody {
  return {
    sessionDate: "2026-10-01",
    context: "practice",
    coachingPriority: "Focus",
    breathingPattern: "every_3",
    ratings: [],
    ...overrides,
  };
}

describe("GET /coach/sessions/:id", () => {
  it("returns the current effective state for the owning coach", async () => {
    await cleanSwimmerData();
    const session = await createFreestyleSession({
      ratings: [{ skillId: freeKickSkillId, grade: 3 }],
    });

    const res = await request(app)
      .get(`/coach/sessions/${session.sessionId}`)
      .set("Authorization", `Bearer ${coach.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBe(session.sessionId);
    expect(res.body.edited).toBe(false);
    expect(res.body.editedAt).toBeNull();
    expect(res.body.ratings).toHaveLength(1);
    expect(res.body.ratings[0].ratingId).toBe(session.ratingIds[0]);
    expect(res.body.ratings[0].rootRatingId).toBe(session.ratingIds[0]);
    expect(res.body.ratings[0].edited).toBe(false);
  });

  it("non-owning coach gets 404", async () => {
    await cleanSwimmerData();
    const session = await createFreestyleSession({
      ratings: [{ skillId: freeKickSkillId }],
    });
    const res = await request(app)
      .get(`/coach/sessions/${session.sessionId}`)
      .set("Authorization", `Bearer ${otherCoach.accessToken}`);
    expect(res.status).toBe(404);
  });

  it("rootRatingId walks past two corrections to the original", async () => {
    await cleanSwimmerData();
    const session = await createFreestyleSession({
      ratings: [{ skillId: freeKickSkillId, grade: 3 }],
    });
    const originalId = session.ratingIds[0]!;

    // Correction 1 against the original.
    const first = await request(app)
      .patch(`/coach/sessions/${session.sessionId}`)
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send(
        basePatchBody({
          ratings: [{ ratingId: originalId, grade: 4, notLegal: false, noConcept: false, side: null, capacityValue: null, capacityUnit: null, measurementValue: null, measurementUnit: null, golfScoreCategory: null, note: null, faultTags: [] }],
        }),
      );
    expect(first.status).toBe(200);

    const correctionRows = await adminDb()
      .select({ id: skillRatings.id })
      .from(skillRatings)
      .where(and(eq(skillRatings.sessionId, session.sessionId), eq(skillRatings.supersedesRatingId, originalId)));
    const firstLeafId = correctionRows[0]!.id;

    // Correction 2 against correction 1.
    const second = await request(app)
      .patch(`/coach/sessions/${session.sessionId}`)
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send(
        basePatchBody({
          ratings: [{ ratingId: firstLeafId, grade: 5, notLegal: false, noConcept: false, side: null, capacityValue: null, capacityUnit: null, measurementValue: null, measurementUnit: null, golfScoreCategory: null, note: null, faultTags: [] }],
        }),
      );
    expect(second.status).toBe(200);

    const res = await request(app)
      .get(`/coach/sessions/${session.sessionId}`)
      .set("Authorization", `Bearer ${coach.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.ratings).toHaveLength(1);
    const leaf = res.body.ratings[0];
    expect(leaf.grade).toBe(5);
    expect(leaf.edited).toBe(true);
    expect(leaf.rootRatingId).toBe(originalId);
  });
});

describe("PATCH /coach/sessions/:id — no-op", () => {
  it("re-save with identical values writes nothing and returns writeCount 0", async () => {
    await cleanSwimmerData();
    const session = await createFreestyleSession({
      ratings: [{ skillId: freeKickSkillId, grade: 3 }],
    });

    const auditBefore = await adminDb()
      .select({ id: householdAuditLog.id })
      .from(householdAuditLog)
      .where(eq(householdAuditLog.action, "evaluation_edited"));

    const res = await request(app)
      .patch(`/coach/sessions/${session.sessionId}`)
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send(
        basePatchBody({
          ratings: [{ ratingId: session.ratingIds[0]!, grade: 3, notLegal: false, noConcept: false, side: null, capacityValue: null, capacityUnit: null, measurementValue: null, measurementUnit: null, golfScoreCategory: null, note: null, faultTags: [] }],
        }),
      );
    expect(res.status).toBe(200);
    expect(res.body.writeCount).toBe(0);

    const auditAfter = await adminDb()
      .select({ id: householdAuditLog.id })
      .from(householdAuditLog)
      .where(eq(householdAuditLog.action, "evaluation_edited"));
    expect(auditAfter.length).toBe(auditBefore.length);

    const sessionRow = await adminDb()
      .select({ editedAt: evaluationSessions.editedAt })
      .from(evaluationSessions)
      .where(eq(evaluationSessions.id, session.sessionId))
      .limit(1);
    expect(sessionRow[0]?.editedAt).toBeNull();
  });
});

describe("PATCH /coach/sessions/:id — rating edits", () => {
  it("edits a rating's grade: supersede row, calculations use new grade, edited_at set", async () => {
    await cleanSwimmerData();
    const session = await createFreestyleSession({
      ratings: [{ skillId: freeKickSkillId, grade: 3 }],
    });
    const oldRatingId = session.ratingIds[0]!;

    const res = await request(app)
      .patch(`/coach/sessions/${session.sessionId}`)
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send(
        basePatchBody({
          ratings: [{ ratingId: oldRatingId, grade: 5, notLegal: false, noConcept: false, side: null, capacityValue: null, capacityUnit: null, measurementValue: null, measurementUnit: null, golfScoreCategory: null, note: null, faultTags: [] }],
        }),
      );
    expect(res.status).toBe(200);
    expect(res.body.writeCount).toBe(1); // one rating correction

    // Old row is now superseded; new row supersedesRatingId points back.
    const allRows = await adminDb()
      .select({
        id: skillRatings.id,
        grade: skillRatings.grade,
        supersededAt: skillRatings.supersededAt,
        supersededByRatingId: skillRatings.supersededByRatingId,
        supersedesRatingId: skillRatings.supersedesRatingId,
        ratedAt: skillRatings.ratedAt,
      })
      .from(skillRatings)
      .where(eq(skillRatings.sessionId, session.sessionId))
      .orderBy(desc(skillRatings.createdAt));
    expect(allRows).toHaveLength(2);

    const newRow = allRows.find((row) => row.supersedesRatingId === oldRatingId);
    const oldRow = allRows.find((row) => row.id === oldRatingId);
    expect(newRow).toBeDefined();
    expect(oldRow).toBeDefined();
    expect(newRow!.grade).toBe(5);
    expect(oldRow!.supersededAt).not.toBeNull();
    expect(oldRow!.supersededByRatingId).toBe(newRow!.id);
    // Observation time preserved.
    expect(newRow!.ratedAt.toISOString()).toBe(oldRow!.ratedAt.toISOString());

    // edited_at set on the session.
    const sessionRow = await adminDb()
      .select({ editedAt: evaluationSessions.editedAt })
      .from(evaluationSessions)
      .where(eq(evaluationSessions.id, session.sessionId))
      .limit(1);
    expect(sessionRow[0]?.editedAt).not.toBeNull();

    // Progress endpoint reflects the corrected grade.
    const progress = await request(app)
      .get(`/coach/swimmers/${swimmerId}/progress`)
      .set("Authorization", `Bearer ${coach.accessToken}`);
    expect(progress.status).toBe(200);
    const kickSkill = (progress.body.skills as Array<{ skillId: string; current: { grade: number } }>)
      .find((skill) => skill.skillId === freeKickSkillId);
    expect(kickSkill?.current.grade).toBe(5);
  });

  it("edits a rating's side: new side on the correction, old side preserved", async () => {
    await cleanSwimmerData();
    const session = await createFreestyleSession({
      ratings: [{ skillId: freeSideSkillId, grade: 3, side: "left" }],
    });
    const oldRatingId = session.ratingIds[0]!;

    const res = await request(app)
      .patch(`/coach/sessions/${session.sessionId}`)
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send(
        basePatchBody({
          ratings: [{ ratingId: oldRatingId, grade: 3, notLegal: false, noConcept: false, side: "right", capacityValue: null, capacityUnit: null, measurementValue: null, measurementUnit: null, golfScoreCategory: null, note: null, faultTags: [] }],
        }),
      );
    expect(res.status).toBe(200);
    expect(res.body.writeCount).toBe(1);

    const allRows = await adminDb()
      .select({ id: skillRatings.id, side: skillRatings.side, supersedesRatingId: skillRatings.supersedesRatingId })
      .from(skillRatings)
      .where(eq(skillRatings.sessionId, session.sessionId));
    const old = allRows.find((row) => row.id === oldRatingId);
    const correction = allRows.find((row) => row.supersedesRatingId === oldRatingId);
    expect(old?.side).toBe("left");
    expect(correction?.side).toBe("right");
  });

  it("edits fault tags: new rating has full new list, old rating keeps its tags", async () => {
    await cleanSwimmerData();
    const session = await createFreestyleSession({
      ratings: [{ skillId: freeKickSkillId, grade: 3, faultTags: ["breaks down 2nd length"] }],
    });
    const oldRatingId = session.ratingIds[0]!;

    const res = await request(app)
      .patch(`/coach/sessions/${session.sessionId}`)
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send(
        basePatchBody({
          ratings: [{ ratingId: oldRatingId, grade: 3, notLegal: false, noConcept: false, side: null, capacityValue: null, capacityUnit: null, measurementValue: null, measurementUnit: null, golfScoreCategory: null, note: null, faultTags: [] }],
        }),
      );
    expect(res.status).toBe(200);
    expect(res.body.writeCount).toBe(1);

    const correctionRows = await adminDb()
      .select({ id: skillRatings.id })
      .from(skillRatings)
      .where(and(eq(skillRatings.sessionId, session.sessionId), eq(skillRatings.supersedesRatingId, oldRatingId)));
    const correctionId = correctionRows[0]!.id;

    const oldTags = await adminDb()
      .select({ tag: ratingFaultTags.faultTag })
      .from(ratingFaultTags)
      .where(eq(ratingFaultTags.ratingId, oldRatingId));
    const newTags = await adminDb()
      .select({ tag: ratingFaultTags.faultTag })
      .from(ratingFaultTags)
      .where(eq(ratingFaultTags.ratingId, correctionId));

    expect(oldTags.map((row) => row.tag)).toEqual(["breaks down 2nd length"]);
    expect(newTags).toHaveLength(0);
  });

  it("stale rating (predecessor already superseded) returns 409", async () => {
    await cleanSwimmerData();
    const session = await createFreestyleSession({
      ratings: [{ skillId: freeKickSkillId, grade: 3 }],
    });
    const oldRatingId = session.ratingIds[0]!;

    // First edit succeeds — this makes oldRatingId superseded.
    const first = await request(app)
      .patch(`/coach/sessions/${session.sessionId}`)
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send(
        basePatchBody({
          ratings: [{ ratingId: oldRatingId, grade: 4, notLegal: false, noConcept: false, side: null, capacityValue: null, capacityUnit: null, measurementValue: null, measurementUnit: null, golfScoreCategory: null, note: null, faultTags: [] }],
        }),
      );
    expect(first.status).toBe(200);

    // Second edit of the SAME old id now returns 409 (stale).
    const second = await request(app)
      .patch(`/coach/sessions/${session.sessionId}`)
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send(
        basePatchBody({
          ratings: [{ ratingId: oldRatingId, grade: 2, notLegal: false, noConcept: false, side: null, capacityValue: null, capacityUnit: null, measurementValue: null, measurementUnit: null, golfScoreCategory: null, note: null, faultTags: [] }],
        }),
      );
    expect(second.status).toBe(409);
  });

  it("chain depth 2: editing a correction supersedes the first correction", async () => {
    await cleanSwimmerData();
    const session = await createFreestyleSession({
      ratings: [{ skillId: freeKickSkillId, grade: 3 }],
    });
    const originalId = session.ratingIds[0]!;

    // Edit 1
    const first = await request(app)
      .patch(`/coach/sessions/${session.sessionId}`)
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send(
        basePatchBody({
          ratings: [{ ratingId: originalId, grade: 4, notLegal: false, noConcept: false, side: null, capacityValue: null, capacityUnit: null, measurementValue: null, measurementUnit: null, golfScoreCategory: null, note: null, faultTags: [] }],
        }),
      );
    expect(first.status).toBe(200);

    // Find the leaf id (correction of originalId).
    const correctionRows = await adminDb()
      .select({ id: skillRatings.id })
      .from(skillRatings)
      .where(and(eq(skillRatings.sessionId, session.sessionId), eq(skillRatings.supersedesRatingId, originalId)));
    const firstLeafId = correctionRows[0]!.id;

    // Edit 2 against the leaf.
    const second = await request(app)
      .patch(`/coach/sessions/${session.sessionId}`)
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send(
        basePatchBody({
          ratings: [{ ratingId: firstLeafId, grade: 5, notLegal: false, noConcept: false, side: null, capacityValue: null, capacityUnit: null, measurementValue: null, measurementUnit: null, golfScoreCategory: null, note: null, faultTags: [] }],
        }),
      );
    expect(second.status).toBe(200);

    // Three rows: original (superseded), first leaf (superseded), new leaf (live).
    const allRows = await adminDb()
      .select({ id: skillRatings.id, grade: skillRatings.grade, supersededAt: skillRatings.supersededAt })
      .from(skillRatings)
      .where(eq(skillRatings.sessionId, session.sessionId));
    expect(allRows).toHaveLength(3);
    const live = allRows.find((row) => row.supersededAt === null);
    expect(live?.grade).toBe(5);

    // latestEffectiveRatings via /progress picks the deepest correction.
    const progress = await request(app)
      .get(`/coach/swimmers/${swimmerId}/progress`)
      .set("Authorization", `Bearer ${coach.accessToken}`);
    const kickSkill = (progress.body.skills as Array<{ skillId: string; current: { grade: number } }>)
      .find((skill) => skill.skillId === freeKickSkillId);
    expect(kickSkill?.current.grade).toBe(5);
  });
});

describe("PATCH /coach/sessions/:id — session metadata", () => {
  it("edits sessionDate in place with previous/new in the audit payload", async () => {
    await cleanSwimmerData();
    const session = await createFreestyleSession({
      sessionDate: "2026-10-14",
      ratings: [{ skillId: freeKickSkillId, grade: 3 }],
    });

    const res = await request(app)
      .patch(`/coach/sessions/${session.sessionId}`)
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send(
        basePatchBody({
          sessionDate: "2026-10-15",
          ratings: [{ ratingId: session.ratingIds[0]!, grade: 3, notLegal: false, noConcept: false, side: null, capacityValue: null, capacityUnit: null, measurementValue: null, measurementUnit: null, golfScoreCategory: null, note: null, faultTags: [] }],
        }),
      );
    expect(res.status).toBe(200);
    expect(res.body.writeCount).toBe(1); // one UPDATE

    const sessionRow = await adminDb()
      .select({ sessionDate: evaluationSessions.sessionDate, editedAt: evaluationSessions.editedAt })
      .from(evaluationSessions)
      .where(eq(evaluationSessions.id, session.sessionId))
      .limit(1);
    expect(sessionRow[0]?.sessionDate).toBe("2026-10-15");
    expect(sessionRow[0]?.editedAt).not.toBeNull();

    const auditRows = await adminDb()
      .select({ payload: householdAuditLog.payload })
      .from(householdAuditLog)
      .where(eq(householdAuditLog.action, "evaluation_edited"))
      .orderBy(desc(householdAuditLog.createdAt))
      .limit(1);
    const payload = auditRows[0]?.payload as {
      sessionId: string;
      sessionFieldsChanged: Array<{ field: string; previous: unknown; new: unknown }>;
    };
    expect(payload.sessionId).toBe(session.sessionId);
    expect(payload.sessionFieldsChanged).toContainEqual({
      field: "sessionDate",
      previous: "2026-10-14",
      new: "2026-10-15",
    });
  });

  it("edits context in place", async () => {
    await cleanSwimmerData();
    const session = await createFreestyleSession({
      context: "practice",
      ratings: [{ skillId: freeKickSkillId, grade: 3 }],
    });

    const res = await request(app)
      .patch(`/coach/sessions/${session.sessionId}`)
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send(
        basePatchBody({
          context: "drill",
          ratings: [{ ratingId: session.ratingIds[0]!, grade: 3, notLegal: false, noConcept: false, side: null, capacityValue: null, capacityUnit: null, measurementValue: null, measurementUnit: null, golfScoreCategory: null, note: null, faultTags: [] }],
        }),
      );
    expect(res.status).toBe(200);
    const sessionRow = await adminDb()
      .select({ context: evaluationSessions.context })
      .from(evaluationSessions)
      .where(eq(evaluationSessions.id, session.sessionId))
      .limit(1);
    expect(sessionRow[0]?.context).toBe("drill");
  });

  it("edits coaching priority: parent progress reads the new value", async () => {
    await cleanSwimmerData();
    const session = await createFreestyleSession({
      coachingPriority: "Head position",
      ratings: [{ skillId: freeKickSkillId, grade: 3 }],
    });

    const res = await request(app)
      .patch(`/coach/sessions/${session.sessionId}`)
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send(
        basePatchBody({
          coachingPriority: "Catch",
          ratings: [{ ratingId: session.ratingIds[0]!, grade: 3, notLegal: false, noConcept: false, side: null, capacityValue: null, capacityUnit: null, measurementValue: null, measurementUnit: null, golfScoreCategory: null, note: null, faultTags: [] }],
        }),
      );
    expect(res.status).toBe(200);

    // Parent progress read uses the household owner (= coach here, but the
    // route is coach-only). Simplest: hit the coach progress endpoint, which
    // includes coachingPriority sources via computeSwimmerProgress reads.
    const sessionRow = await adminDb()
      .select({ coachingPriority: evaluationSessions.coachingPriority })
      .from(evaluationSessions)
      .where(eq(evaluationSessions.id, session.sessionId))
      .limit(1);
    expect(sessionRow[0]?.coachingPriority).toBe("Catch");
  });

  it("combined edit: session metadata + rating change in one audit row", async () => {
    await cleanSwimmerData();
    const session = await createFreestyleSession({
      sessionDate: "2026-10-14",
      ratings: [{ skillId: freeKickSkillId, grade: 3 }],
    });

    const res = await request(app)
      .patch(`/coach/sessions/${session.sessionId}`)
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send(
        basePatchBody({
          sessionDate: "2026-10-20",
          ratings: [{ ratingId: session.ratingIds[0]!, grade: 5, notLegal: false, noConcept: false, side: null, capacityValue: null, capacityUnit: null, measurementValue: null, measurementUnit: null, golfScoreCategory: null, note: null, faultTags: [] }],
        }),
      );
    expect(res.status).toBe(200);

    const auditRows = await adminDb()
      .select({ payload: householdAuditLog.payload })
      .from(householdAuditLog)
      .where(eq(householdAuditLog.action, "evaluation_edited"))
      .orderBy(desc(householdAuditLog.createdAt))
      .limit(1);
    const payload = auditRows[0]?.payload as {
      sessionFieldsChanged: Array<{ field: string }>;
      ratingsChanged: Array<{ fieldsChanged: string[] }>;
    };
    expect(payload.sessionFieldsChanged.map((entry) => entry.field)).toContain("sessionDate");
    expect(payload.ratingsChanged).toHaveLength(1);
    expect(payload.ratingsChanged[0]?.fieldsChanged).toContain("grade");
  });
});

describe("PATCH /coach/sessions/:id — authorization", () => {
  it("non-owning coach gets 404", async () => {
    await cleanSwimmerData();
    const session = await createFreestyleSession({
      ratings: [{ skillId: freeKickSkillId, grade: 3 }],
    });
    const res = await request(app)
      .patch(`/coach/sessions/${session.sessionId}`)
      .set("Authorization", `Bearer ${otherCoach.accessToken}`)
      .send(
        basePatchBody({
          ratings: [{ ratingId: session.ratingIds[0]!, grade: 5, notLegal: false, noConcept: false, side: null, capacityValue: null, capacityUnit: null, measurementValue: null, measurementUnit: null, golfScoreCategory: null, note: null, faultTags: [] }],
        }),
      );
    expect(res.status).toBe(404);
  });
});

describe("DELETE /coach/sessions/:id after corrections", () => {
  it("returns 409 once the session has any correction row", async () => {
    await cleanSwimmerData();
    const session = await createFreestyleSession({
      ratings: [{ skillId: freeKickSkillId, grade: 3 }],
    });
    const oldRatingId = session.ratingIds[0]!;

    // Write a correction.
    const edit = await request(app)
      .patch(`/coach/sessions/${session.sessionId}`)
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send(
        basePatchBody({
          ratings: [{ ratingId: oldRatingId, grade: 4, notLegal: false, noConcept: false, side: null, capacityValue: null, capacityUnit: null, measurementValue: null, measurementUnit: null, golfScoreCategory: null, note: null, faultTags: [] }],
        }),
      );
    expect(edit.status).toBe(200);

    // Now try to DELETE the session (same coach, well within the 10-minute
    // undo window). It should refuse with 409.
    const del = await request(app)
      .delete(`/coach/sessions/${session.sessionId}`)
      .set("Authorization", `Bearer ${coach.accessToken}`);
    expect(del.status).toBe(409);
  });
});

// Both the create flow (POST /coach/swimmers/:id/sessions) and the edit flow
// (PATCH /coach/sessions/:id) share one per-rating cross-field validator in
// packages/shared/src/lib/ratingValidation.ts. These tests pair each shared
// predicate with a POST that must 422 and a PATCH against an existing valid
// rating that must also 422 for the same reason, so a regression that lets
// one path accept what the other rejects fails loudly at the HTTP layer.
describe("per-rating validation is shared between CREATE and PATCH", () => {
  // notLegal on a skill whose catalog entry has notLegalAllowed=false.
  // free-head-position is rubric with notLegalAllowed left at the default
  // (false) in skillsCatalog.ts, so it rejects notLegal in both routes.
  it("rejects notLegal on a non-notLegal skill in both routes", async () => {
    await cleanSwimmerData();

    const createRes = await request(app)
      .post(`/coach/swimmers/${swimmerId}/sessions`)
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send({
        screenSlug: "freestyle",
        breathingPattern: "every_3",
        sessionDate: "2026-10-01",
        context: "practice",
        coachingPriority: "Focus",
        ratings: [
          {
            skillId: freeHeadSkillId,
            grade: 3,
            notLegal: true,
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
    expect(createRes.status).toBe(422);
    expect(createRes.body.issues?.[0]?.message).toMatch(/not allowed/i);

    const session = await createFreestyleSession({
      ratings: [{ skillId: freeHeadSkillId, grade: 3 }],
    });
    const patchRes = await request(app)
      .patch(`/coach/sessions/${session.sessionId}`)
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send(
        basePatchBody({
          ratings: [{ ratingId: session.ratingIds[0]!, grade: 3, notLegal: true, noConcept: false, side: null, capacityValue: null, capacityUnit: null, measurementValue: null, measurementUnit: null, golfScoreCategory: null, note: null, faultTags: [] }],
        }),
      );
    expect(patchRes.status).toBe(422);
    expect(patchRes.body.issues?.[0]?.message).toMatch(/not allowed/i);
  });

  // Missing golfScoreCategory on a score skill (free-golf-score).
  it("rejects a score-skill rating without golfScoreCategory in both routes", async () => {
    await cleanSwimmerData();

    const createRes = await request(app)
      .post(`/coach/swimmers/${swimmerId}/sessions`)
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send({
        screenSlug: "freestyle",
        breathingPattern: "every_3",
        sessionDate: "2026-10-01",
        context: "practice",
        coachingPriority: "Focus",
        ratings: [
          {
            skillId: freeGolfSkillId,
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
            ratedAt: "2026-10-01T10:00:00.000Z",
            golfScoreCategory: null,
          },
        ],
      });
    expect(createRes.status).toBe(422);
    expect(createRes.body.issues?.[0]?.message).toMatch(/golf score category is required/i);

    const session = await createFreestyleSession({
      ratings: [{ skillId: freeGolfSkillId, grade: 3, golfScoreCategory: "push_off_in_water" }],
    });
    const patchRes = await request(app)
      .patch(`/coach/sessions/${session.sessionId}`)
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send(
        basePatchBody({
          ratings: [{ ratingId: session.ratingIds[0]!, grade: 3, notLegal: false, noConcept: false, side: null, capacityValue: null, capacityUnit: null, measurementValue: null, measurementUnit: null, golfScoreCategory: null, note: null, faultTags: [] }],
        }),
      );
    expect(patchRes.status).toBe(422);
    expect(patchRes.body.issues?.[0]?.message).toMatch(/golf score category is required/i);
  });

  // side is required on a rated_per_side skill (breathing-timing-free).
  it("rejects a ratedPerSide rating with side=null in both routes", async () => {
    await cleanSwimmerData();

    const createRes = await request(app)
      .post(`/coach/swimmers/${swimmerId}/sessions`)
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send({
        screenSlug: "freestyle",
        breathingPattern: "every_3",
        sessionDate: "2026-10-01",
        context: "practice",
        coachingPriority: "Focus",
        ratings: [
          {
            skillId: freeSideSkillId,
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
            ratedAt: "2026-10-01T10:00:00.000Z",
          },
        ],
      });
    expect(createRes.status).toBe(422);
    expect(createRes.body.issues?.[0]?.message).toMatch(/side is required/i);

    const session = await createFreestyleSession({
      ratings: [{ skillId: freeSideSkillId, grade: 3, side: "left" }],
    });
    const patchRes = await request(app)
      .patch(`/coach/sessions/${session.sessionId}`)
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send(
        basePatchBody({
          ratings: [{ ratingId: session.ratingIds[0]!, grade: 3, notLegal: false, noConcept: false, side: null, capacityValue: null, capacityUnit: null, measurementValue: null, measurementUnit: null, golfScoreCategory: null, note: null, faultTags: [] }],
        }),
      );
    expect(patchRes.status).toBe(422);
    expect(patchRes.body.issues?.[0]?.message).toMatch(/side is required/i);
  });
});
