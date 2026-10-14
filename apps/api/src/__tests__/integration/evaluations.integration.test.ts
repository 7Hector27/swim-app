// Integration tests for evaluation_sessions and skill_ratings CHECK constraints.
// Requires a running local Supabase stack (pnpm db:up) with migrations applied.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  adminDb,
  closeAdminDb,
  createTestUser,
  hardDeleteSwimmer,
} from "./helpers";
import {
  evaluationSessions,
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

beforeAll(async () => {
  const coach = await createTestUser("eval-constraints");
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

describe("skill_ratings append-only trigger", () => {
  let ratingId: string;

  beforeAll(async () => {
    const rows = await adminDb()
      .insert(skillRatings)
      .values(validRatingValues())
      .returning({ id: skillRatings.id });
    ratingId = rows[0]!.id;
  });

  afterAll(async () => {
    await adminDb().delete(skillRatings).where(eq(skillRatings.id, ratingId));
  });

  it("allows setting void fields", async () => {
    await expect(
      adminDb()
        .update(skillRatings)
        .set({ voidedAt: new Date(), voidReason: "test", voidBy: coachId })
        .where(eq(skillRatings.id, ratingId)),
    ).resolves.not.toThrow();
    // Reset void fields for subsequent tests.
    await adminDb()
      .update(skillRatings)
      .set({ voidedAt: null, voidReason: null, voidBy: null })
      .where(eq(skillRatings.id, ratingId));
  });

  it("rejects changing grade after insert", async () => {
    await expect(
      adminDb()
        .update(skillRatings)
        .set({ grade: 5 })
        .where(eq(skillRatings.id, ratingId)),
    ).rejects.toMatchObject({ message: expect.stringContaining("append-only") });
  });

  it("rejects changing not_legal after insert", async () => {
    await expect(
      adminDb()
        .update(skillRatings)
        .set({ notLegal: true })
        .where(eq(skillRatings.id, ratingId)),
    ).rejects.toMatchObject({ message: expect.stringContaining("append-only") });
  });

  it("rejects changing note after insert", async () => {
    await expect(
      adminDb()
        .update(skillRatings)
        .set({ note: "changed" })
        .where(eq(skillRatings.id, ratingId)),
    ).rejects.toMatchObject({ message: expect.stringContaining("append-only") });
  });
});
