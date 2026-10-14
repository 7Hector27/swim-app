// Integration tests for evaluation_sessions and skill_ratings CHECK constraints.
// Requires a running local Supabase stack (pnpm db:up) with migrations applied.

import type { Server } from "http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
  ratingFaultTags,
  skillCategories,
  skillRatings,
  skills,
  swimmers,
} from "../../db/schema";

let coachId: string;
let swimmerId: string;
let categoryId: string;
let skillId: string;
let sessionId: string;
let cleanupCoach: () => Promise<void>;
let coach: TestUser;

beforeAll(async () => {
  coach = await createTestUser("eval-constraints");
  coachId = coach.userId;
  cleanupCoach = coach.cleanup;

  // Insert a minimal skill category and skill for FK satisfaction.
  const catRows = await adminDb()
    .insert(skillCategories)
    .values({ slug: "eval-test-cat", name: "Eval Test", sortOrder: 9999 })
    .returning({ id: skillCategories.id });
  categoryId = catRows[0]!.id;

  const skillRows = await adminDb()
    .insert(skills)
    .values({
      slug: "eval-test-skill",
      categoryId,
      name: "Eval Test Skill",
      type: "rubric",
      sortOrder: 9999,
    })
    .returning({ id: skills.id });
  skillId = skillRows[0]!.id;

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
  // fault_tags cascade-delete from skill_ratings, so just delete ratings first.
  await adminDb().delete(skillRatings).where(eq(skillRatings.sessionId, sessionId));
  await adminDb().delete(evaluationSessions).where(eq(evaluationSessions.id, sessionId));
  await hardDeleteSwimmer(swimmerId);
  // skill → skill_dependencies cascade; category → skills cascade.
  await adminDb().delete(skills).where(eq(skills.id, skillId));
  await adminDb().delete(skillCategories).where(eq(skillCategories.id, categoryId));
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

// ── evaluation_sessions ───────────────────────────────────────────────────────

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

// ── skill_ratings CHECK constraints ──────────────────────────────────────────

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

    const sidedSkillRows = await adminDb()
      .insert(skills)
      .values({
        slug: "eval-test-sided-skill",
        categoryId,
        name: "Eval Test Sided Skill",
        type: "rubric",
        sortOrder: 10000,
        ratedPerSide: true,
      })
      .returning({ id: skills.id });
    ratedPerSideSkillId = sidedSkillRows[0]!.id;
  });

  afterAll(async () => {
    server.close();
    await adminDb().delete(skills).where(eq(skills.id, ratedPerSideSkillId));
  });

  // ── POST /coach/swimmers/:id/sessions: invalid rating → no session or ratings ──

  it("a session with one archived skill rating saves nothing (transaction rollback)", async () => {
    await adminDb().update(skills).set({ archivedAt: new Date() }).where(eq(skills.id, skillId));

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

    // Un-archive the skill for subsequent tests.
    await adminDb().update(skills).set({ archivedAt: null }).where(eq(skills.id, skillId));
  });

  // ── DELETE /coach/ratings/:id: undo window ──────────────────────────────────

  it("DELETE within 9-minute window → 204 and rating is gone", async () => {
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

    await adminDb()
      .update(skillRatings)
      .set({ createdAt: new Date(Date.now() - 9 * 60 * 1000) })
      .where(eq(skillRatings.id, ratingId));

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

    await adminDb()
      .update(skillRatings)
      .set({ createdAt: new Date(Date.now() - 11 * 60 * 1000) })
      .where(eq(skillRatings.id, ratingId));

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

    // skillId: latest non-voided is grade 3 (grade 5 was voided).
    expect(grades["eval-test-skill"]).toBe(3);

    // ratedPerSide skill: both sides present.
    expect(grades["eval-test-sided-skill:left"]).toBe(4);
    expect(grades["eval-test-sided-skill:right"]).toBe(2);

    for (const row of [r1[0]!, r2[0]!, r3[0]!, r4[0]!]) {
      await adminDb().delete(skillRatings).where(eq(skillRatings.id, row.id));
    }
  });
});
