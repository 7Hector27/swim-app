import { z } from "zod";
import { latestEffectiveRatings, type RatingRecord } from "./dependencyMap";

export const StartGradeResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("not_legal") }),
  z.object({ status: z.literal("in_progress"), missing: z.array(z.string()) }),
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

// Calculates the overall start grade from a swimmer's skill rating history.
//
// componentSlugs: the 6 catalog skill slugs that are child skills of this
// start (track, relay, or backstroke). Passed by the caller so the function
// has no catalog dependency.
//
// ratings: the swimmer's full (or start-filtered) skill_ratings history.
// latestEffectiveRatings handles voided and per-skill deduplication.
//
// Rules applied in order:
//   1. If any component's latest effective rating is not_legal → "not_legal".
//   2. If any of the 6 components have no current rating → "in_progress".
//   3. If every rated component is no_concept → "no_concept".
//   4. Otherwise → floor(avg), excluding no_concept from the denominator.
//      not_legal counts as 0 in the average (though rule 1 prevents it from
//      reaching this point in practice).
export function calculateStartGrade(
  componentSlugs: string[],
  ratings: RatingRecord[],
): StartGradeResult {
  const effective = latestEffectiveRatings(ratings);

  for (const slug of componentSlugs) {
    if (effective[slug] === "not_legal") {
      return { status: "not_legal" };
    }
  }

  const missing = componentSlugs.filter(
    (slug) => effective[slug] === undefined || effective[slug] === null,
  );
  if (missing.length > 0) {
    return { status: "in_progress", missing };
  }

  const allNoConcept = componentSlugs.every((slug) => effective[slug] === "no_concept");
  if (allNoConcept) {
    return { status: "no_concept" };
  }

  let sum = 0;
  let count = 0;
  for (const slug of componentSlugs) {
    const grade = effective[slug];
    if (grade === "no_concept") continue;
    sum += grade === "not_legal" ? 0 : (grade ?? 0);
    count += 1;
  }

  const grade = Math.max(1, Math.floor(sum / count)) as 1 | 2 | 3 | 4 | 5;
  return { status: "graded", grade };
}
