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
    side: z.enum(["left", "right"]).nullable(),
    grade: z
      .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)])
      .nullable(),
    notLegal: z.boolean(),
    noConcept: z.boolean(),
    ratedAt: z.string(),
    voidedAt: z.string().nullable(),
    // Set on predecessor rows when a correction row supersedes them. The
    // filter in latestEffectiveRatings drops any row with this field set,
    // the same way voided rows are dropped. ADR 032.
    supersededAt: z.string().nullable(),
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

export type ChainEntry = { slug: string; notAssessed: boolean };

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

// Returns the latest non-voided, non-superseded grade per skill (or per
// skill+side for sided skills) from a swimmer's rating history. The key is
// `skillSlug` for non-sided skills and `skillSlug:side` for side-rated skills.
// notLegal and noConcept flags take precedence over the numeric grade field.
// Skills where every rating has been voided or superseded are absent.
// Superseded predecessors drop out exactly the same way voids do (ADR 032):
// the correction row is the one that counts.
export function latestEffectiveRatings(history: RatingRecord[]): GradeMap {
  const byKey = new Map<string, RatingRecord[]>();
  for (const record of history) {
    const key = record.side !== null ? `${record.skillSlug}:${record.side}` : record.skillSlug;
    const existing = byKey.get(key);
    if (existing !== undefined) {
      existing.push(record);
    } else {
      byKey.set(key, [record]);
    }
  }

  const result: GradeMap = {};
  for (const [key, records] of byKey) {
    const sorted = [...records].sort(
      (recordA, recordB) => Date.parse(recordB.ratedAt) - Date.parse(recordA.ratedAt),
    );
    const latest = sorted.find(
      (record) => record.voidedAt === null && record.supersededAt === null,
    );
    if (latest === undefined) continue;
    if (latest.notLegal) {
      result[key] = "not_legal";
    } else if (latest.noConcept) {
      result[key] = "no_concept";
    } else {
      result[key] = latest.grade;
    }
  }
  return result;
}

// Returns the effective grade for a side-rated skill given its left and right grades.
// not_legal on either side → not_legal. Both no_concept → no_concept.
// One no_concept → the other side's grade. One absent → the other side's grade.
// Both numeric → the lower (weaker) grade.
export function weakerSideGrade(
  left: SkillGrade | undefined,
  right: SkillGrade | undefined,
): SkillGrade {
  if (left === "not_legal" || right === "not_legal") return "not_legal";
  const l = left === undefined ? null : left;
  const r = right === undefined ? null : right;
  if (l === "no_concept" && r === "no_concept") return "no_concept";
  if (l === "no_concept") return r;
  if (r === "no_concept") return l;
  if (l === null && r === null) return null;
  if (l === null) return r;
  if (r === null) return l;
  return Math.min(l, r) as 1 | 2 | 3 | 4 | 5;
}

// Walks the builtOn chain from targetSlug and returns the full chain from target
// down to the deepest low foundation skill.
//
// Returns null if the target itself is not low (grade > 2 and not not_legal or
// no_concept). A null or missing target grade also returns null.
//
// When multiple foundations are equally low, ties break by sortOrder (ascending).
// Without sortOrder, iteration order (first match) acts as the fallback.
//
// When no low foundation exists, checks for an unrated (null) foundation and
// includes it as the final entry with notAssessed: true.
export function findDeepestLowFoundation(
  targetSlug: string,
  grades: GradeMap,
  graph: BuiltOnGraph,
  sortOrder?: SortOrderMap,
): ChainEntry[] | null {
  const targetGrade = grades[targetSlug] ?? null;
  if (!isLow(targetGrade, null)) return null;

  const visited = new Set<string>();

  function descend(slug: string): ChainEntry[] {
    if (visited.has(slug)) return [{ slug, notAssessed: false }];
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

    if (bestSlug === null) {
      let unratedSlug: string | null = null;
      let unratedOrder = Infinity;
      for (const [index, foundationSlug] of foundations.entries()) {
        const foundationGrade = grades[foundationSlug] ?? null;
        if (foundationGrade === null) {
          const order = sortOrder?.[foundationSlug] ?? index;
          if (order < unratedOrder) {
            unratedOrder = order;
            unratedSlug = foundationSlug;
          }
        }
      }
      if (unratedSlug !== null) {
        return [{ slug, notAssessed: false }, { slug: unratedSlug, notAssessed: true }];
      }
      return [{ slug, notAssessed: false }];
    }
    return [{ slug, notAssessed: false }, ...descend(bestSlug)];
  }

  return descend(targetSlug);
}
