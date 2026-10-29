import { eq, isNull } from "drizzle-orm";
import { db } from "../db/client";
import { evaluationSessions, skillCategories, skillRatings, skills } from "../db/schema";
import {
  calculateStartGrade,
  headPositionOverall,
  latestEffectiveRatings,
  weakerSideGrade,
  type GradeMap,
  type PerStrokeGrades,
  type RatingRecord,
  type ScoreHistoryResponse,
  type ScoreHistoryPoint,
  type ScoreHistoryCategoryRollup,
  type ScoreHistoryStart,
} from "@swim-app/shared";

const HEAD_POSITION_SLUGS = {
  free: "head-position-free",
  back: "head-position-back",
  breast: "head-position-breast",
  fly: "head-position-fly",
} as const;

// Collapses sided GradeMap keys (slug:left / slug:right) into a single effective
// grade per plain slug. Non-sided keys are copied through. Mirrors the collapse
// loop in computeSwimmerProgress so category rollups and head-position lookups
// use the same effective grades.
function collapseSidedGrades(grades: GradeMap): GradeMap {
  const collapsed: GradeMap = {};
  for (const [key, value] of Object.entries(grades)) {
    if (!key.includes(":")) {
      collapsed[key] = value;
    } else {
      const plainSlug = key.slice(0, key.lastIndexOf(":"));
      if (!(plainSlug in collapsed)) {
        collapsed[plainSlug] = weakerSideGrade(
          grades[`${plainSlug}:left`],
          grades[`${plainSlug}:right`],
        );
      }
    }
  }
  return collapsed;
}

type FullRow = {
  slug: string;
  grade: number | null;
  notLegal: boolean;
  noConcept: boolean;
  side: "left" | "right" | null;
  ratedAt: Date;
  voidedAt: Date | null;
  supersededAt: Date | null;
  sessionDate: string;
};

function rowToRecord(row: FullRow): RatingRecord {
  return {
    skillSlug: row.slug,
    side: row.side,
    grade: row.grade as 1 | 2 | 3 | 4 | 5 | null,
    notLegal: row.notLegal,
    noConcept: row.noConcept,
    ratedAt: row.ratedAt.toISOString(),
    voidedAt: row.voidedAt?.toISOString() ?? null,
    supersededAt: row.supersededAt?.toISOString() ?? null,
  };
}

// Returns a swimmer's history as a time-series of as-of snapshots: one point
// per distinct session_date that has at least one non-voided rating. Each point
// re-runs the current calculation functions (latestEffectiveRatings,
// weakerSideGrade, headPositionOverall, calculateStartGrade) over only the
// ratings whose session_date ≤ the point's date, so values at each date match
// what the live progress endpoint would return if later ratings did not exist.
export async function computeScoreHistory(swimmerId: string): Promise<ScoreHistoryResponse> {
  const ratingRows: FullRow[] = await db
    .select({
      slug: skills.slug,
      grade: skillRatings.grade,
      notLegal: skillRatings.notLegal,
      noConcept: skillRatings.noConcept,
      side: skillRatings.side,
      ratedAt: skillRatings.ratedAt,
      voidedAt: skillRatings.voidedAt,
      supersededAt: skillRatings.supersededAt,
      sessionDate: evaluationSessions.sessionDate,
    })
    .from(skillRatings)
    .innerJoin(skills, eq(skills.id, skillRatings.skillId))
    .innerJoin(evaluationSessions, eq(evaluationSessions.id, skillRatings.sessionId))
    .where(eq(skillRatings.swimmerId, swimmerId));

  const allSkillRows = await db
    .select({
      id: skills.id,
      slug: skills.slug,
      name: skills.name,
      parentSkillId: skills.parentSkillId,
      categoryId: skills.categoryId,
      categorySlug: skillCategories.slug,
      categoryName: skillCategories.name,
      categorySortOrder: skillCategories.sortOrder,
    })
    .from(skills)
    .innerJoin(skillCategories, eq(skillCategories.id, skills.categoryId))
    .where(isNull(skills.archivedAt));

  type CategoryBucket = {
    categoryId: string;
    categorySlug: string;
    categoryName: string;
    sortOrder: number;
    skillSlugs: string[];
  };
  const categoryBuckets = new Map<string, CategoryBucket>();
  for (const row of allSkillRows) {
    const existing = categoryBuckets.get(row.categoryId);
    if (existing) {
      existing.skillSlugs.push(row.slug);
    } else {
      categoryBuckets.set(row.categoryId, {
        categoryId: row.categoryId,
        categorySlug: row.categorySlug,
        categoryName: row.categoryName,
        sortOrder: row.categorySortOrder,
        skillSlugs: [row.slug],
      });
    }
  }
  const orderedCategories = [...categoryBuckets.values()].sort(
    (categoryA, categoryB) => categoryA.sortOrder - categoryB.sortOrder,
  );

  const startParents = allSkillRows.filter((skill) => skill.slug.endsWith("-start"));
  const starts = startParents
    .map((parent) => ({
      slug: parent.slug,
      name: parent.name,
      componentSlugs: allSkillRows
        .filter((skill) => skill.parentSkillId === parent.id)
        .map((skill) => skill.slug),
    }))
    .filter((start) => start.componentSlugs.length > 0);

  // "non-voided evaluation date" — unique session_date with ≥1 non-voided rating.
  const nonVoidedDates = new Set<string>();
  for (const row of ratingRows) {
    if (row.voidedAt === null) nonVoidedDates.add(row.sessionDate);
  }
  const sortedDates = [...nonVoidedDates].sort();

  const points: ScoreHistoryPoint[] = [];
  for (const date of sortedDates) {
    const asOfRecords: RatingRecord[] = ratingRows
      .filter((row) => row.sessionDate <= date)
      .map(rowToRecord);

    const grades = latestEffectiveRatings(asOfRecords);
    const collapsed = collapseSidedGrades(grades);

    const perStroke: PerStrokeGrades = {
      ...(collapsed[HEAD_POSITION_SLUGS.free] !== undefined && { free: collapsed[HEAD_POSITION_SLUGS.free] }),
      ...(collapsed[HEAD_POSITION_SLUGS.back] !== undefined && { back: collapsed[HEAD_POSITION_SLUGS.back] }),
      ...(collapsed[HEAD_POSITION_SLUGS.breast] !== undefined && { breast: collapsed[HEAD_POSITION_SLUGS.breast] }),
      ...(collapsed[HEAD_POSITION_SLUGS.fly] !== undefined && { fly: collapsed[HEAD_POSITION_SLUGS.fly] }),
    };
    const headPosOverall = headPositionOverall(perStroke);

    const categoryRollups: ScoreHistoryCategoryRollup[] = orderedCategories.map((bucket) => {
      let sum = 0;
      let assessedCount = 0;
      for (const slug of bucket.skillSlugs) {
        const grade = collapsed[slug];
        if (grade === undefined || grade === null) continue;
        if (grade === "no_concept") continue;
        sum += grade === "not_legal" ? 0 : grade;
        assessedCount += 1;
      }
      return {
        categoryId: bucket.categoryId,
        categorySlug: bucket.categorySlug,
        categoryName: bucket.categoryName,
        average: assessedCount > 0 ? sum / assessedCount : null,
        assessedCount,
        totalCount: bucket.skillSlugs.length,
      };
    });

    const startEntries: ScoreHistoryStart[] = starts.map((start) => ({
      slug: start.slug,
      name: start.name,
      grade: calculateStartGrade(start.componentSlugs, asOfRecords),
    }));

    points.push({
      sessionDate: date,
      headPositionOverall: headPosOverall,
      categoryRollups,
      starts: startEntries,
    });
  }

  return { points };
}
