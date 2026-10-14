// Integration tests for evaluation_sessions and skill_ratings CHECK constraints.
// Requires a running local Supabase stack (pnpm db:up) with migrations applied.

import type { Server } from "http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
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
  profiles,
  ratingFaultTags,
  skillDependencies,
  skillRatings,
  skills,
  swimmers,
} from "../../db/schema";
import syncCatalogFn from "../../db/scripts/syncCatalogFn";

let coachId: string;
let swimmerId: string;
let categoryId: string;
let skillId: string;
let sessionId: string;
let cleanupCoach: () => Promise<void>;
let coach: TestUser;

beforeAll(async () => {
  // Ensure the catalog is populated so we can look up real skills by slug.
  await syncCatalogFn(adminDb());

  coach = await createTestUser("eval-constraints");
  coachId = coach.userId;
  cleanupCoach = coach.cleanup;

  // Promote the test user to coach so requireCoach middleware passes.
  await adminDb()
    .update(profiles)
    .set({ role: "coach" })
    .where(eq(profiles.id, coachId));

  // Use a real catalog skill so the skillsCatalogSync count tests stay clean.
  const freeKickRows = await adminDb()
    .select({ id: skills.id, categoryId: skills.categoryId })
    .from(skills)
    .where(eq(skills.slug, "free-kick"))
    .limit(1);
  if (!freeKickRows[0]) throw new Error("Catalog skill free-kick not found — run pnpm db:sync-catalog");
  skillId = freeKickRows[0].id;
  categoryId = freeKickRows[0].categoryId;

  const swimmerRows = await adminDb()
    .insert(swimmers)
    .values({
      firstName: "Eval",
      lastName: "Testswimmer",
      birthDate: "2015-01-01",
      sex: "female",
      isPublic: false,
      householdId: coach.householdId,
    })
    .returning({ id: swimmers.id });
  swimmerId = swimmerRows[0]!.id;

  // Valid session used as FK for rating constraint tests.
  const sessionRows = await adminDb()
    .insert(evaluationSessions)
    .values({
      swimmerId,
      coachId,
      categoryId,
      sessionDate: "2026-10-01",
      context: "practice",
      coachingPriority: "Focus on core stability",
    })
    .returning({ id: evaluationSessions.id });
  sessionId = sessionRows[0]!.id;
});

afterAll(async () => {
  // Delete ratings and sessions by swimmerId (catches any rows from API tests
  // that created additional sessions or from tests that failed mid-cleanup).
  // Fault tags cascade-delete when their rating is deleted.
  await adminDb().delete(skillRatings).where(eq(skillRatings.swimmerId, swimmerId));
  await adminDb().delete(evaluationSessions).where(eq(evaluationSessions.swimmerId, swimmerId));
  await hardDeleteSwimmer(swimmerId);
  await cleanupCoach();
  await closeAdminDb();
});

function validRatingValues() {
  return {
    sessionId,
    swimmerId,
    skillId,
    coachId,
    grade: 3,
    notLegal: false,
    noConcept: false,
    ratedAt: new Date("2026-10-01T10:00:00Z"),
  } as const;
}

// ── evaluation_sessions CHECK constraints ───────────────────────────────────

describe("evaluation_sessions CHECK constraints", () => {
  it("accepts a valid session", async () => {
    const rows = await adminDb()
      .insert(evaluationSessions)
      .values({
        swimmerId,
        coachId,
        categoryId,
        sessionDate: "2026-10-02",
        context: "drill",
        coachingPriority: "Bilateral breathing",
      })
      .returning({ id: evaluationSessions.id });
    expect(rows[0]!.id).toBeTruthy();
    await adminDb().delete(evaluationSessions).where(eq(evaluationSessions.id, rows[0]!.id));
  });

  it("rejects blank coaching_priority", async () => {
    await expect(
      adminDb().insert(evaluationSessions).values({
        swimmerId,
        coachId,
        categoryId,
        sessionDate: "2026-10-03",
        context: "practice",
        coachingPriority: "",
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining("coaching_priority_not_blank") });
  });
});

// ── skill_ratings CHECK constraints ─────────────────────────────────────────

describe("skill_ratings CHECK constraints", () => {
  it("accepts a valid grade=3 rating", async () => {
    const rows = await adminDb()
      .insert(skillRatings)
      .values(validRatingValues())
      .returning({ id: skillRatings.id });
    expect(rows[0]!.id).toBeTruthy();
    await adminDb().delete(skillRatings).where(eq(skillRatings.id, rows[0]!.id));
  });

  it("accepts not_legal=true alongside a phantom grade", async () => {
    const rows = await adminDb()
      .insert(skillRatings)
      .values({ ...validRatingValues(), grade: 2, notLegal: true })
      .returning({ id: skillRatings.id });
    expect(rows[0]!.id).toBeTruthy();
    await adminDb().delete(skillRatings).where(eq(skillRatings.id, rows[0]!.id));
  });

  it("accepts no_concept=true with grade=null", async () => {
    const rows = await adminDb()
      .insert(skillRatings)
      .values({ ...validRatingValues(), grade: null, noConcept: true })
      .returning({ id: skillRatings.id });
    expect(rows[0]!.id).toBeTruthy();
    await adminDb().delete(skillRatings).where(eq(skillRatings.id, rows[0]!.id));
  });

  it("rejects grade=null with no_concept=false (neither grade nor no_concept)", async () => {
    await expect(
      adminDb().insert(skillRatings).values({ ...validRatingValues(), grade: null, noConcept: false }),
    ).rejects.toMatchObject({ message: expect.stringContaining("grade_xor_no_concept") });
  });

  it("rejects grade=3 with no_concept=true (both set)", async () => {
    await expect(
      adminDb().insert(skillRatings).values({ ...validRatingValues(), grade: 3, noConcept: true }),
    ).rejects.toMatchObject({ message: expect.stringContaining("grade_xor_no_concept") });
  });

  it("rejects grade=0 (below range)", async () => {
    await expect(
      adminDb().insert(skillRatings).values({ ...validRatingValues(), grade: 0 }),
    ).rejects.toMatchObject({ message: expect.stringContaining("grade_xor_no_concept") });
  });

  it("rejects grade=6 (above range)", async () => {
    await expect(
      adminDb().insert(skillRatings).values({ ...validRatingValues(), grade: 6 }),
    ).rejects.toMatchObject({ message: expect.stringContaining("grade_xor_no_concept") });
  });

  it("rejects capacity_value set with capacity_unit null", async () => {
    await expect(
      adminDb().insert(skillRatings).values({
        ...validRatingValues(),
        capacityValue: "25",
        capacityUnit: null,
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining("capacity_value_and_unit_consistent") });
  });

  it("rejects capacity_unit set with capacity_value null", async () => {
    await expect(
      adminDb().insert(skillRatings).values({
        ...validRatingValues(),
        capacityValue: null,
        capacityUnit: "yards",
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining("capacity_value_and_unit_consistent") });
  });

  it("rejects measurement_value set with measurement_unit null", async () => {
    await expect(
      adminDb().insert(skillRatings).values({
        ...validRatingValues(),
        measurementValue: "32",
        measurementUnit: null,
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining("measurement_value_and_unit_consistent") });
  });

  it("rejects measurement_unit set with measurement_value null", async () => {
    await expect(
      adminDb().insert(skillRatings).values({
        ...validRatingValues(),
        measurementValue: null,
        measurementUnit: "seconds",
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining("measurement_value_and_unit_consistent") });
  });

  it("rejects partial void — voided_at set but void_reason and void_by null", async () => {
    await expect(
      adminDb().insert(skillRatings).values({
        ...validRatingValues(),
        voidedAt: new Date(),
        voidReason: null,
        voidBy: null,
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining("void_fields_consistent") });
  });

  it("rejects partial void — void_reason set but voided_at and void_by null", async () => {
    await expect(
      adminDb().insert(skillRatings).values({
        ...validRatingValues(),
        voidedAt: null,
        voidReason: "Wrong skill",
        voidBy: null,
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining("void_fields_consistent") });
  });

  it("accepts a fully voided rating (all three void fields set)", async () => {
    const rows = await adminDb()
      .insert(skillRatings)
      .values({
        ...validRatingValues(),
        voidedAt: new Date(),
        voidReason: "Correction",
        voidBy: coachId,
      })
      .returning({ id: skillRatings.id });
    expect(rows[0]!.id).toBeTruthy();
    await adminDb().delete(skillRatings).where(eq(skillRatings.id, rows[0]!.id));
  });

  it("accepts capacity with both value and unit set", async () => {
    const rows = await adminDb()
      .insert(skillRatings)
      .values({ ...validRatingValues(), capacityValue: "50", capacityUnit: "yards" })
      .returning({ id: skillRatings.id });
    expect(rows[0]!.id).toBeTruthy();
    await adminDb().delete(skillRatings).where(eq(skillRatings.id, rows[0]!.id));
  });

  it("accepts measurement with both value and unit set", async () => {
    const rows = await adminDb()
      .insert(skillRatings)
      .values({
        ...validRatingValues(),
        measurementValue: "28.5",
        measurementUnit: "stroke_cycles_per_minute",
      })
      .returning({ id: skillRatings.id });
    expect(rows[0]!.id).toBeTruthy();
    await adminDb().delete(skillRatings).where(eq(skillRatings.id, rows[0]!.id));
  });

  it("rejects not_legal=true with grade=null (not_legal_requires_grade)", async () => {
    // noConcept=true with grade=null satisfies grade_xor_no_concept (second clause).
    // Only not_legal_requires_grade fires because notLegal=true requires a non-null grade.
    await expect(
      adminDb().insert(skillRatings).values({
        ...validRatingValues(),
        grade: null,
        noConcept: true,
        notLegal: true,
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining("not_legal_requires_grade") });
  });

  it("accepts not_legal=true with a phantom grade (not_legal_requires_grade passes)", async () => {
    const rows = await adminDb()
      .insert(skillRatings)
      .values({ ...validRatingValues(), grade: 2, notLegal: true, noConcept: false })
      .returning({ id: skillRatings.id });
    expect(rows[0]!.id).toBeTruthy();
    await adminDb().delete(skillRatings).where(eq(skillRatings.id, rows[0]!.id));
  });
});

// ── skill_ratings append-only trigger ────────────────────────────────────────

async function withFreshRating(fn: (id: string) => Promise<void>): Promise<void> {
  const rows = await adminDb()
    .insert(skillRatings)
    .values(validRatingValues())
    .returning({ id: skillRatings.id });
  const id = rows[0]!.id;
  try {
    await fn(id);
  } finally {
    await adminDb().delete(skillRatings).where(eq(skillRatings.id, id));
  }
}

describe("skill_ratings append-only trigger", () => {
  it("allows setting void fields", async () => {
    await withFreshRating(async (id) => {
      await expect(
        adminDb()
          .update(skillRatings)
          .set({ voidedAt: new Date(), voidReason: "test", voidBy: coachId })
          .where(eq(skillRatings.id, id)),
      ).resolves.not.toThrow();
    });
  });

  const appendOnlyCases: [string, Partial<typeof skillRatings.$inferInsert>][] = [
    ["grade", { grade: 5 }],
    ["not_legal", { notLegal: true }],
    ["no_concept", { noConcept: true }],
    ["note", { note: "changed" }],
    ["side", { side: "left" }],
    ["capacity_value", { capacityValue: "100" }],
    ["capacity_unit", { capacityUnit: "reps" }],
    ["measurement_value", { measurementValue: "10.5" }],
    ["measurement_unit", { measurementUnit: "seconds" }],
  ];

  it.each(appendOnlyCases)("rejects changing %s after insert", async (_, patch) => {
    await withFreshRating(async (id) => {
      await expect(
        adminDb()
          .update(skillRatings)
          .set(patch)
          .where(eq(skillRatings.id, id)),
      ).rejects.toMatchObject({ message: expect.stringContaining("append-only") });
    });
  });
});

// ── API integration tests ──────────────────────────────────────────────────

describe("API integration tests — evaluations routes", () => {
  const logger = pino({ level: "silent" });
  const app = createApp(logger);
  let server: Server;
  let coachToken: string;
  let ratedPerSideSkillId: string;

  beforeAll(async () => {
    server = app.listen(0);
    coachToken = coach.accessToken;

    // Use a real catalog sided skill instead of inserting a test fixture.
    const sidedSkillRows = await adminDb()
      .select({ id: skills.id })
      .from(skills)
      .where(eq(skills.slug, "breathing-timing-free"))
      .limit(1);
    if (!sidedSkillRows[0]) throw new Error("Catalog skill breathing-timing-free not found — run pnpm db:sync-catalog");
    ratedPerSideSkillId = sidedSkillRows[0].id;
  });

  afterAll(async () => {
    server.close();
    // ratedPerSideSkillId is a real catalog skill — do not delete it.
  });

  // ── POST /coach/swimmers/:id/sessions: invalid rating → no session or ratings ──

  it("a session with one archived skill rating saves nothing (transaction rollback)", async () => {
    // Archive the real catalog skill temporarily.
    await adminDb().update(skills).set({ archivedAt: new Date() }).where(eq(skills.id, skillId));

    try {
      const response = await request(app)
        .post(`/coach/swimmers/${swimmerId}/sessions`)
        .set("Authorization", `Bearer ${coachToken}`)
        .send({
          categoryId,
          sessionDate: "2026-10-15",
          context: "practice",
          coachingPriority: "Test rollback",
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
              ratedAt: "2026-10-15T10:00:00.000Z",
            },
          ],
        });

      expect(response.status).toBe(422);

      const sessions = await adminDb()
        .select({ id: evaluationSessions.id })
        .from(evaluationSessions)
        .where(eq(evaluationSessions.swimmerId, swimmerId));
      // Only the one session created in beforeAll should exist.
      expect(sessions.length).toBe(1);
    } finally {
      // Always restore the skill so subsequent tests are not affected.
      await adminDb().update(skills).set({ archivedAt: null }).where(eq(skills.id, skillId));
    }
  });

  // ── DELETE /coach/ratings/:id: undo window ──────────────────────────────────

  it("DELETE within 9-minute window → 204 and rating is gone", async () => {
    // Insert with a backdated created_at directly — the append-only trigger
    // blocks UPDATE on created_at, so we cannot insert then update.
    const rows = await adminDb()
      .insert(skillRatings)
      .values({
        sessionId,
        swimmerId,
        skillId,
        coachId,
        grade: 3,
        notLegal: false,
        noConcept: false,
        ratedAt: new Date(),
        createdAt: new Date(Date.now() - 9 * 60 * 1000),
      })
      .returning({ id: skillRatings.id });
    const ratingId = rows[0]!.id;

    const response = await request(app)
      .delete(`/coach/ratings/${ratingId}`)
      .set("Authorization", `Bearer ${coachToken}`);
    expect(response.status).toBe(204);

    const remaining = await adminDb()
      .select({ id: skillRatings.id })
      .from(skillRatings)
      .where(eq(skillRatings.id, ratingId));
    expect(remaining).toHaveLength(0);
  });

  it("DELETE after 11-minute window → 409", async () => {
    // Insert with a backdated created_at directly.
    const rows = await adminDb()
      .insert(skillRatings)
      .values({
        sessionId,
        swimmerId,
        skillId,
        coachId,
        grade: 3,
        notLegal: false,
        noConcept: false,
        ratedAt: new Date(),
        createdAt: new Date(Date.now() - 11 * 60 * 1000),
      })
      .returning({ id: skillRatings.id });
    const ratingId = rows[0]!.id;

    const response = await request(app)
      .delete(`/coach/ratings/${ratingId}`)
      .set("Authorization", `Bearer ${coachToken}`);
    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/void/i);

    await adminDb().delete(skillRatings).where(eq(skillRatings.id, ratingId));
  });

  it("DELETE within window also removes fault tag rows (cascade delete)", async () => {
    const rows = await adminDb()
      .insert(skillRatings)
      .values({
        sessionId,
        swimmerId,
        skillId,
        coachId,
        grade: 3,
        notLegal: false,
        noConcept: false,
        ratedAt: new Date(),
      })
      .returning({ id: skillRatings.id });
    const ratingId = rows[0]!.id;

    await adminDb().insert(ratingFaultTags).values({ ratingId, faultTag: "test-tag" });

    const response = await request(app)
      .delete(`/coach/ratings/${ratingId}`)
      .set("Authorization", `Bearer ${coachToken}`);
    expect(response.status).toBe(204);

    const tags = await adminDb()
      .select()
      .from(ratingFaultTags)
      .where(eq(ratingFaultTags.ratingId, ratingId));
    expect(tags).toHaveLength(0);
  });

  // ── PATCH void: atomicity and double-void ───────────────────────────────────

  it("PATCH void sets all three void fields atomically", async () => {
    const rows = await adminDb()
      .insert(skillRatings)
      .values({
        sessionId,
        swimmerId,
        skillId,
        coachId,
        grade: 3,
        notLegal: false,
        noConcept: false,
        ratedAt: new Date(),
      })
      .returning({ id: skillRatings.id });
    const ratingId = rows[0]!.id;

    const response = await request(app)
      .patch(`/coach/ratings/${ratingId}/void`)
      .set("Authorization", `Bearer ${coachToken}`)
      .send({ reason: "Wrong swimmer" });
    expect(response.status).toBe(200);

    const updated = await adminDb()
      .select({
        voidedAt: skillRatings.voidedAt,
        voidReason: skillRatings.voidReason,
        voidBy: skillRatings.voidBy,
      })
      .from(skillRatings)
      .where(eq(skillRatings.id, ratingId));
    expect(updated[0]!.voidedAt).not.toBeNull();
    expect(updated[0]!.voidReason).toBe("Wrong swimmer");
    expect(updated[0]!.voidBy).toBe(coachId);

    await adminDb().delete(skillRatings).where(eq(skillRatings.id, ratingId));
  });

  it("second void returns 409", async () => {
    const rows = await adminDb()
      .insert(skillRatings)
      .values({
        sessionId,
        swimmerId,
        skillId,
        coachId,
        grade: 3,
        notLegal: false,
        noConcept: false,
        ratedAt: new Date(),
        voidedAt: new Date(),
        voidReason: "already voided",
        voidBy: coachId,
      })
      .returning({ id: skillRatings.id });
    const ratingId = rows[0]!.id;

    const response = await request(app)
      .patch(`/coach/ratings/${ratingId}/void`)
      .set("Authorization", `Bearer ${coachToken}`)
      .send({ reason: "Another reason" });
    expect(response.status).toBe(409);

    await adminDb().delete(skillRatings).where(eq(skillRatings.id, ratingId));
  });

  // ── GET /coach/swimmers/:id/skills matches shared helpers ───────────────────

  it("GET /skills: grades match latestEffectiveRatings, voided latest falls back, side-rated returns both sides", async () => {
    const r1 = await adminDb()
      .insert(skillRatings)
      .values({
        sessionId,
        swimmerId,
        skillId,
        coachId,
        grade: 3,
        notLegal: false,
        noConcept: false,
        ratedAt: new Date("2026-10-01T10:00:00Z"),
      })
      .returning({ id: skillRatings.id });

    const r2 = await adminDb()
      .insert(skillRatings)
      .values({
        sessionId,
        swimmerId,
        skillId,
        coachId,
        grade: 5,
        notLegal: false,
        noConcept: false,
        ratedAt: new Date("2026-10-02T10:00:00Z"),
        voidedAt: new Date("2026-10-03T10:00:00Z"),
        voidReason: "Incorrect",
        voidBy: coachId,
      })
      .returning({ id: skillRatings.id });

    const r3 = await adminDb()
      .insert(skillRatings)
      .values({
        sessionId,
        swimmerId,
        skillId: ratedPerSideSkillId,
        coachId,
        grade: 4,
        notLegal: false,
        noConcept: false,
        side: "left",
        ratedAt: new Date("2026-10-01T10:00:00Z"),
      })
      .returning({ id: skillRatings.id });

    const r4 = await adminDb()
      .insert(skillRatings)
      .values({
        sessionId,
        swimmerId,
        skillId: ratedPerSideSkillId,
        coachId,
        grade: 2,
        notLegal: false,
        noConcept: false,
        side: "right",
        ratedAt: new Date("2026-10-01T10:00:00Z"),
      })
      .returning({ id: skillRatings.id });

    const response = await request(app)
      .get(`/coach/swimmers/${swimmerId}/skills`)
      .set("Authorization", `Bearer ${coachToken}`);
    expect(response.status).toBe(200);

    const { grades } = response.body as { grades: Record<string, unknown> };

    // skillId (free-kick): latest non-voided is grade 3 (grade 5 was voided).
    expect(grades["free-kick"]).toBe(3);

    // ratedPerSide skill (breathing-timing-free): both sides present.
    expect(grades["breathing-timing-free:left"]).toBe(4);
    expect(grades["breathing-timing-free:right"]).toBe(2);

    for (const row of [r1[0]!, r2[0]!, r3[0]!, r4[0]!]) {
      await adminDb().delete(skillRatings).where(eq(skillRatings.id, row.id));
    }
  });

  // ── DELETE /coach/sessions/:id: undo window ──────────────────────────────────

  describe("DELETE /coach/sessions/:id", () => {
    let testSessionId: string;

    beforeEach(async () => {
      // Create a fresh session for each delete test
      const sessionRows = await adminDb()
        .insert(evaluationSessions)
        .values({
          swimmerId,
          coachId,
          categoryId,
          sessionDate: "2026-10-01",
          context: "practice",
          coachingPriority: "Delete test session",
        })
        .returning({ id: evaluationSessions.id });
      testSessionId = sessionRows[0]!.id;
    });

    afterEach(async () => {
      // Clean up in case the test didn't delete it
      await adminDb().delete(skillRatings).where(eq(skillRatings.sessionId, testSessionId)).catch(() => {});
      await adminDb().delete(evaluationSessions).where(eq(evaluationSessions.id, testSessionId)).catch(() => {});
    });

    it("deletes session within 10 minutes → 204", async () => {
      const response = await request(server)
        .delete(`/coach/sessions/${testSessionId}`)
        .set("Authorization", `Bearer ${coachToken}`);
      expect(response.status).toBe(204);
      // Verify session is gone
      const rows = await adminDb()
        .select({ id: evaluationSessions.id })
        .from(evaluationSessions)
        .where(eq(evaluationSessions.id, testSessionId));
      expect(rows).toHaveLength(0);
    });

    it("session created more than 10 minutes ago → 409", async () => {
      // Backdate the session by 11 minutes via direct update
      // (created_at is not protected by the append-only trigger on skill_ratings)
      await adminDb()
        .update(evaluationSessions)
        .set({ createdAt: new Date(Date.now() - 11 * 60 * 1000) })
        .where(eq(evaluationSessions.id, testSessionId));

      const response = await request(server)
        .delete(`/coach/sessions/${testSessionId}`)
        .set("Authorization", `Bearer ${coachToken}`);
      expect(response.status).toBe(409);
    });

    it("wrong coach → 404", async () => {
      const other = await createTestUser("del-session-other");
      await adminDb().update(profiles).set({ role: "coach" }).where(eq(profiles.id, other.userId));

      const response = await request(server)
        .delete(`/coach/sessions/${testSessionId}`)
        .set("Authorization", `Bearer ${other.accessToken}`);
      await other.cleanup();
      expect(response.status).toBe(404);
    });
  });

  it("GET /skills coachingPriorities: weak left side on a sided skill produces a chain with plain slug", async () => {
    // 1. Look up a foundation skill of breathing-timing-free.
    const depRows = await adminDb()
      .select({ dependsOnSkillId: skillDependencies.dependsOnSkillId })
      .from(skillDependencies)
      .where(eq(skillDependencies.skillId, ratedPerSideSkillId))
      .limit(1);
    if (!depRows[0]) throw new Error("breathing-timing-free has no dependencies in catalog — cannot run test");
    const foundationSkillId = depRows[0].dependsOnSkillId;

    const foundationSlugRows = await adminDb()
      .select({ slug: skills.slug })
      .from(skills)
      .where(eq(skills.id, foundationSkillId))
      .limit(1);
    if (!foundationSlugRows[0]) throw new Error("Foundation skill not found");
    const foundationSlug = foundationSlugRows[0].slug;

    // 2. Insert a grade-1 rating for breathing-timing-free left side.
    const r1 = await adminDb()
      .insert(skillRatings)
      .values({
        sessionId,
        swimmerId,
        skillId: ratedPerSideSkillId,
        coachId,
        grade: 1,
        notLegal: false,
        noConcept: false,
        side: "left",
        ratedAt: new Date("2026-10-10T10:00:00Z"),
      })
      .returning({ id: skillRatings.id });

    // 3. Insert a grade-1 rating for the foundation skill (non-sided).
    const r2 = await adminDb()
      .insert(skillRatings)
      .values({
        sessionId,
        swimmerId,
        skillId: foundationSkillId,
        coachId,
        grade: 1,
        notLegal: false,
        noConcept: false,
        ratedAt: new Date("2026-10-10T10:00:00Z"),
      })
      .returning({ id: skillRatings.id });

    // 4. Call GET /coach/swimmers/:id/skills.
    const response = await request(app)
      .get(`/coach/swimmers/${swimmerId}/skills`)
      .set("Authorization", `Bearer ${coachToken}`);

    // 5. Assert 200.
    expect(response.status).toBe(200);

    // 6. Find the coachingPriority entry with targetSlug === "breathing-timing-free" (plain slug).
    const { coachingPriorities } = response.body as {
      coachingPriorities: Array<{ targetSlug: string; chain: Array<{ slug: string }> }>;
    };
    const entry = coachingPriorities.find((priority) => priority.targetSlug === "breathing-timing-free");
    expect(entry).toBeDefined();

    // 7. Assert the chain has length >= 2 (breathing-timing-free -> foundation).
    expect(entry!.chain.length).toBeGreaterThanOrEqual(2);

    // Verify the foundation slug appears somewhere in the chain.
    const chainSlugs = entry!.chain.map((chainEntry) => chainEntry.slug);
    expect(chainSlugs).toContain(foundationSlug);

    // 8. Cleanup.
    await adminDb().delete(skillRatings).where(eq(skillRatings.id, r1[0]!.id));
    await adminDb().delete(skillRatings).where(eq(skillRatings.id, r2[0]!.id));
  });
});
