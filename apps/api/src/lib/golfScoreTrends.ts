// Shared golf-score-trends computation used by both the coach route
// (/coach/swimmers/:id/golf-score-trends) and the parent route
// (/swimmers/:id/golf-score). The two routes serve the same data
// shape — per stroke + category trend points plus an age-group band —
// with one difference: the parent route strips `sessionId` from each
// point before shipping, since parents can't reach the per-session
// edit affordance it deep-links to.

import type { Logger } from "pino";
import { and, asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "../db/client";
import { evaluationSessions, skillRatings, skills, swimmers } from "../db/schema";
import { isActiveSwimmer } from "../db/queries";
import {
  ageToGroup,
  calculateAge,
  GolfScoreCategorySchema,
  todayLA,
  type GolfScoreAgeBands,
  type GolfScoreCategoryTrend,
  type GolfScoreTrend,
} from "@swim-app/shared";

function computePercentile(sorted: number[], p: number): number {
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower]!;
  return sorted[lower]! + (index - lower) * (sorted[upper]! - sorted[lower]!);
}

export async function computeGolfScoreTrends(
  swimmerId: string,
  logger: Pick<Logger, "warn">,
): Promise<{ trends: GolfScoreTrend[] }> {
  const ratingRows = await db
    .select({
      grade: skillRatings.grade,
      timeSeconds: skillRatings.timeSeconds,
      strokeCountValue: skillRatings.strokeCountValue,
      golfScoreCategory: skillRatings.golfScoreCategory,
      ratedAt: skillRatings.ratedAt,
      sessionId: skillRatings.sessionId,
      sessionDate: evaluationSessions.sessionDate,
      skillId: skills.id,
      slug: skills.slug,
      name: skills.name,
    })
    .from(skillRatings)
    .innerJoin(skills, eq(skills.id, skillRatings.skillId))
    .innerJoin(evaluationSessions, eq(evaluationSessions.id, skillRatings.sessionId))
    .where(
      and(
        eq(skillRatings.swimmerId, swimmerId),
        isNull(skillRatings.voidedAt),
        isNull(skillRatings.supersededAt),
        eq(skills.type, "score"),
        isNotNull(skillRatings.golfScoreCategory),
      ),
    )
    .orderBy(asc(skillRatings.ratedAt));

  const swimmerRows = await db
    .select({ birthDate: swimmers.birthDate })
    .from(swimmers)
    .where(eq(swimmers.id, swimmerId))
    .limit(1);

  const birthDate = swimmerRows[0]?.birthDate ?? null;
  const ageGroup = birthDate !== null ? ageToGroup(calculateAge(birthDate, todayLA())) : null;

  type SkillKey = string;
  type CategoryKey = string;

  const skillMap = new Map<SkillKey, { slug: string; name: string; categories: Map<CategoryKey, Array<typeof ratingRows[number]>> }>();

  for (const row of ratingRows) {
    const category = row.golfScoreCategory;
    if (category === null) continue;

    let skillEntry = skillMap.get(row.skillId);
    if (!skillEntry) {
      skillEntry = { slug: row.slug, name: row.name, categories: new Map() };
      skillMap.set(row.skillId, skillEntry);
    }

    let categoryPoints = skillEntry.categories.get(category);
    if (!categoryPoints) {
      categoryPoints = [];
      skillEntry.categories.set(category, categoryPoints);
    }

    categoryPoints.push(row);
  }

  const trends: GolfScoreTrend[] = [];

  // Fetch cohort swimmer IDs once, before any skill/category loops, to avoid N+1 queries.
  let cohortIds: string[] = [];
  if (ageGroup !== null) {
    const cohortSwimmerRows = await db
      .select({ id: swimmers.id, birthDate: swimmers.birthDate })
      .from(swimmers)
      .where(isActiveSwimmer);

    const today = todayLA();
    cohortIds = cohortSwimmerRows
      .filter((cohortSwimmer) => {
        if (cohortSwimmer.id === swimmerId) return false;
        const swimmerAgeGroup = ageToGroup(calculateAge(cohortSwimmer.birthDate, today));
        return swimmerAgeGroup === ageGroup;
      })
      .map((cohortSwimmer) => cohortSwimmer.id);
  }

  // Collect every (skillSlug, category) pair that has at least one point for
  // this swimmer — anything else can't surface an age band, so we don't
  // fetch cohort ratings for it. The cohort fetch below runs ONCE across
  // all pairs instead of N times inside the per-category loop (the N+1 fix).
  const cohortSlugs = new Set<string>();
  const cohortCategories = new Set<string>();
  for (const [, skillEntry] of skillMap) {
    for (const [category] of skillEntry.categories) {
      cohortSlugs.add(skillEntry.slug);
      cohortCategories.add(category);
    }
  }

  // Bucket of latest-per-swimmer cohort values per (slug, category). Keyed
  // by `${slug}::${category}` so the per-category loop can read it in O(1).
  // Stays empty when ageGroup is null, cohort is empty, or this swimmer
  // has no scored points at all.
  const cohortValuesByKey = new Map<string, number[]>();

  if (ageGroup !== null && cohortIds.length > 0 && cohortSlugs.size > 0) {
    const cohortRows = await db
      .select({
        swimmerId: skillRatings.swimmerId,
        slug: skills.slug,
        category: skillRatings.golfScoreCategory,
        timeSeconds: skillRatings.timeSeconds,
        strokeCountValue: skillRatings.strokeCountValue,
        ratedAt: skillRatings.ratedAt,
      })
      .from(skillRatings)
      .innerJoin(skills, eq(skills.id, skillRatings.skillId))
      .where(
        and(
          inArray(skills.slug, Array.from(cohortSlugs)),
          inArray(skillRatings.golfScoreCategory, Array.from(cohortCategories)),
          isNull(skillRatings.voidedAt),
          isNull(skillRatings.supersededAt),
          isNotNull(skillRatings.timeSeconds),
          isNotNull(skillRatings.strokeCountValue),
          inArray(skillRatings.swimmerId, cohortIds),
          eq(skills.type, "score"),
        ),
      )
      .orderBy(skillRatings.swimmerId, desc(skillRatings.ratedAt));

    // One "latest per cohort swimmer" per (slug, category) key. Walks the
    // rows ordered by swimmerId + desc(ratedAt) so the first row seen for
    // a given (key, swimmerId) is the newest — identical to the original
    // per-category selection logic.
    const seenByKey = new Map<string, Set<string>>();
    for (const row of cohortRows) {
      if (row.category === null) continue;
      const key = `${row.slug}::${row.category}`;
      let seen = seenByKey.get(key);
      if (!seen) {
        seen = new Set();
        seenByKey.set(key, seen);
      }
      if (seen.has(row.swimmerId)) continue;
      seen.add(row.swimmerId);
      const time = row.timeSeconds === null ? NaN : parseFloat(row.timeSeconds);
      const strokes = row.strokeCountValue;
      if (!isNaN(time) && strokes !== null) {
        let values = cohortValuesByKey.get(key);
        if (!values) {
          values = [];
          cohortValuesByKey.set(key, values);
        }
        values.push(time + strokes);
      }
    }
  }

  for (const [, skillEntry] of skillMap) {
    const byCategory: GolfScoreCategoryTrend[] = [];

    for (const [category, points] of skillEntry.categories) {
      const parsedCategory = GolfScoreCategorySchema.safeParse(category);
      if (!parsedCategory.success) {
        logger.warn(
          { swimmerId, skillSlug: skillEntry.slug, unknownCategory: category },
          "golf-score-trends: skipping unknown GolfScoreCategory",
        );
        continue;
      }

      let ageBands: GolfScoreAgeBands | null = null;
      const latestValues = cohortValuesByKey.get(`${skillEntry.slug}::${category}`);
      if (latestValues && latestValues.length >= 10) {
        const sorted = [...latestValues].sort((first, second) => first - second);
        ageBands = {
          bandCount: sorted.length,
          p25: computePercentile(sorted, 25),
          p50: computePercentile(sorted, 50),
          p75: computePercentile(sorted, 75),
        };
      }

      byCategory.push({
        category: parsedCategory.data,
        points: points.map((point) => ({
          ratedAt: point.ratedAt.toISOString(),
          sessionDate: point.sessionDate,
          sessionId: point.sessionId,
          grade: point.grade,
          timeSeconds: point.timeSeconds === null ? null : parseFloat(point.timeSeconds),
          strokeCountValue: point.strokeCountValue,
        })),
        ageBands,
      });
    }

    if (byCategory.length > 0) {
      trends.push({
        skillSlug: skillEntry.slug,
        skillName: skillEntry.name,
        byCategory,
      });
    }
  }

  return { trends };
}
