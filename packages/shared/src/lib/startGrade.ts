import { z } from "zod";

export const StartComponentSchema = z.enum([
  "reaction_time",
  "block_position",
  "entry_angle",
  "entry_point",
  "streamline",
  "breakout",
]);
export type StartComponent = z.infer<typeof StartComponentSchema>;

const ALL_COMPONENTS = StartComponentSchema.options;

export const StartComponentRatingRecordSchema = z.object({
  component: StartComponentSchema,
  grade: z
    .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)])
    .nullable(),
  notLegal: z.boolean(),
  noConcept: z.boolean(),
  ratedAt: z.string(),
  voidedAt: z.string().nullable(),
});
export type StartComponentRatingRecord = z.infer<typeof StartComponentRatingRecordSchema>;

export const StartGradeResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("not_legal") }),
  z.object({ status: z.literal("in_progress"), missing: z.array(StartComponentSchema) }),
  z.object({ status: z.literal("no_concept") }),
  z.object({
    status: z.literal("graded"),
    grade: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
    ]),
  }),
]);
export type StartGradeResult = z.infer<typeof StartGradeResultSchema>;

type EffectiveComponentGrade = {
  notLegal: boolean;
  noConcept: boolean;
  grade: 1 | 2 | 3 | 4 | 5 | null;
};

// Returns the latest non-voided grade per component, mirroring latestEffectiveRatings.
// Components where every rating has been voided are absent from the result.
function latestEffectiveComponentRatings(
  history: StartComponentRatingRecord[],
): Map<StartComponent, EffectiveComponentGrade> {
  const byComponent = new Map<StartComponent, StartComponentRatingRecord[]>();
  for (const record of history) {
    const existing = byComponent.get(record.component);
    if (existing !== undefined) {
      existing.push(record);
    } else {
      byComponent.set(record.component, [record]);
    }
  }

  const result = new Map<StartComponent, EffectiveComponentGrade>();
  for (const [component, records] of byComponent) {
    const sorted = [...records].sort(
      (recordA, recordB) => Date.parse(recordB.ratedAt) - Date.parse(recordA.ratedAt),
    );
    const latest = sorted.find((record) => record.voidedAt === null);
    if (latest === undefined) continue;
    result.set(component, {
      notLegal: latest.notLegal,
      noConcept: latest.noConcept,
      grade: latest.grade,
    });
  }
  return result;
}

// Calculates the overall start grade from a swimmer's full component rating history.
//
// Rules applied in order:
//   1. If any component's latest effective rating is not_legal → "not_legal".
//   2. If any of the 6 components have no current rating → "in_progress".
//   3. If every rated component is no_concept → "no_concept".
//   4. Otherwise → floor(avg), excluding no_concept from the denominator.
//      not_legal counts as 0 in the average (though rule 1 prevents it from
//      reaching this point in practice).
export function calculateStartGrade(
  history: StartComponentRatingRecord[],
): StartGradeResult {
  const effective = latestEffectiveComponentRatings(history);

  for (const [, rating] of effective) {
    if (rating.notLegal) {
      return { status: "not_legal" };
    }
  }

  const missing = ALL_COMPONENTS.filter((component) => !effective.has(component));
  if (missing.length > 0) {
    return { status: "in_progress", missing };
  }

  const allNoConcept = [...effective.values()].every((rating) => rating.noConcept);
  if (allNoConcept) {
    return { status: "no_concept" };
  }

  let sum = 0;
  let count = 0;
  for (const [, rating] of effective) {
    if (rating.noConcept) continue;
    sum += rating.notLegal ? 0 : (rating.grade ?? 0);
    count += 1;
  }

  const grade = Math.floor(sum / count) as 1 | 2 | 3 | 4 | 5;
  return { status: "graded", grade };
}
