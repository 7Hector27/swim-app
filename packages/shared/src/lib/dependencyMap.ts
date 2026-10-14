import { z } from "zod";

export const SkillGradeSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal("not_legal"),
  z.literal("no_concept"),
  z.null(),
]);
export type SkillGrade = z.infer<typeof SkillGradeSchema>;

export const BuiltOnGraphSchema = z.record(z.string(), z.array(z.string()));
export type BuiltOnGraph = z.infer<typeof BuiltOnGraphSchema>;

export const GradeMapSchema = z.record(z.string(), SkillGradeSchema);
export type GradeMap = z.infer<typeof GradeMapSchema>;

export const SortOrderMapSchema = z.record(z.string(), z.number());
export type SortOrderMap = z.infer<typeof SortOrderMapSchema>;

export const RatingRecordSchema = z
  .object({
    skillSlug: z.string(),
    grade: z
      .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)])
      .nullable(),
    notLegal: z.boolean(),
    noConcept: z.boolean(),
    ratedAt: z.string(),
    voidedAt: z.string().nullable(),
  })
  .superRefine((val, ctx) => {
    // grade 1–5 when noConcept is false; grade null when noConcept is true.
    if (!val.noConcept && val.grade === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "grade must be 1–5 when noConcept is false",
        path: ["grade"],
      });
    }
    if (val.noConcept && val.grade !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "grade must be null when noConcept is true",
        path: ["grade"],
      });
    }
    // notLegal accompanies a phantom 1–5 grade.
    if (val.notLegal && val.grade === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "notLegal requires a non-null grade",
        path: ["notLegal"],
      });
    }
  });
export type RatingRecord = z.infer<typeof RatingRecordSchema>;

export const PerStrokeGradesSchema = z.object({
  free: SkillGradeSchema.optional(),
  back: SkillGradeSchema.optional(),
  breast: SkillGradeSchema.optional(),
  fly: SkillGradeSchema.optional(),
});
export type PerStrokeGrades = z.infer<typeof PerStrokeGradesSchema>;

function numericGrade(grade: SkillGrade): number {
  if (grade === "not_legal" || grade === "no_concept") return 0;
  if (grade === null) return -1;
  return grade;
}

function isLow(grade: SkillGrade, supporterGrade: SkillGrade): boolean {
  if (grade === null) return false;
  if (grade === "not_legal" || grade === "no_concept") return true;
  if (grade <= 2) return true;
  if (
    supporterGrade !== null &&
    supporterGrade !== "not_legal" &&
    supporterGrade !== "no_concept" &&
    grade < supporterGrade
  ) {
    return true;
  }
  return false;
}

// Returns floor(avg) of the rated per-stroke head positions.
// null and no_concept strokes are excluded; not_legal counts as 0.
// Returns null when no strokes have been rated yet.
// Clamps result to minimum 1 so the return value is always a valid SkillGrade.
export function headPositionOverall(
  perStrokeGrades: PerStrokeGrades,
): 1 | 2 | 3 | 4 | 5 | null {
  const strokes = ["free", "back", "breast", "fly"] as const;
  let sum = 0;
  let count = 0;
  for (const stroke of strokes) {
    const grade = perStrokeGrades[stroke];
    if (grade === undefined || grade === null || grade === "no_concept") continue;
    sum += grade === "not_legal" ? 0 : grade;
    count += 1;
  }
  if (count === 0) return null;
  return Math.max(1, Math.floor(sum / count)) as 1 | 2 | 3 | 4 | 5;
}

// Returns the latest non-voided grade per skill from a swimmer's rating history.
// notLegal and noConcept flags take precedence over the numeric grade field.
// Skills where every rating has been voided are absent from the result.
export function latestEffectiveRatings(history: RatingRecord[]): GradeMap {
  const bySkill = new Map<string, RatingRecord[]>();
  for (const record of history) {
    const existing = bySkill.get(record.skillSlug);
    if (existing !== undefined) {
      existing.push(record);
    } else {
      bySkill.set(record.skillSlug, [record]);
    }
  }

  const result: GradeMap = {};
  for (const [slug, records] of bySkill) {
    const sorted = [...records].sort(
      (recordA, recordB) => Date.parse(recordB.ratedAt) - Date.parse(recordA.ratedAt),
    );
    const latest = sorted.find((record) => record.voidedAt === null);
    if (latest === undefined) continue;
    if (latest.notLegal) {
      result[slug] = "not_legal";
    } else if (latest.noConcept) {
      result[slug] = "no_concept";
    } else {
      result[slug] = latest.grade;
    }
  }
  return result;
}

// Walks the builtOn chain from targetSlug and returns the full chain from target
// down to the deepest low foundation skill.
//
// Returns null if the target itself is not low (grade > 2 and not not_legal or
// no_concept). A null or missing target grade also returns null.
//
// When multiple foundations are equally low, ties break by sortOrder (ascending).
// Without sortOrder, iteration order (first match) acts as the fallback.
export function findDeepestLowFoundation(
  targetSlug: string,
  grades: GradeMap,
  graph: BuiltOnGraph,
  sortOrder?: SortOrderMap,
): string[] | null {
  const targetGrade = grades[targetSlug] ?? null;
  if (!isLow(targetGrade, null)) return null;

  const visited = new Set<string>();

  function descend(slug: string): string[] {
    if (visited.has(slug)) return [slug];
    visited.add(slug);

    const currentGrade = grades[slug] ?? null;
    const foundations = graph[slug] ?? [];

    let bestSlug: string | null = null;
    let bestNumeric = Infinity;
    let bestOrder = Infinity;

    for (const [index, foundationSlug] of foundations.entries()) {
      const foundationGrade = grades[foundationSlug] ?? null;
      if (!isLow(foundationGrade, currentGrade)) continue;

      const numeric = numericGrade(foundationGrade);
      const order = sortOrder?.[foundationSlug] ?? index;

      if (
        numeric < bestNumeric ||
        (numeric === bestNumeric && order < bestOrder)
      ) {
        bestNumeric = numeric;
        bestOrder = order;
        bestSlug = foundationSlug;
      }
    }

    if (bestSlug === null) return [slug];
    return [slug, ...descend(bestSlug)];
  }

  return descend(targetSlug);
}
