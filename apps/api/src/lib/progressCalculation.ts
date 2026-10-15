import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db/client";
import {
  evaluationSessions,
  ratingFaultTags,
  skillCategories,
  skillDependencies,
  skillRatings,
  skills,
} from "../db/schema";
import {
  findDeepestLowFoundation,
  headPositionOverall,
  latestEffectiveRatings,
  calculateStartGrade,
  weakerSideGrade,
  type RatingRecord,
  type GradeMap,
  type BuiltOnGraph,
  type SortOrderMap,
  type PerStrokeGrades,
  type SwimmerProgressResponse,
  type SkillCurrentLevel,
  type StartProgress,
  type ProgressCoachingPriority,
} from "@swim-app/shared";

type SkillBucket = {
  skillId: string;
  slug: string;
  name: string;
  categoryId: string;
  categoryName: string;
  type: string;
  unit: string | null;
  ratedPerSide: boolean;
  parentSkillId: string | null;
  points: Array<{
    id: string;
    grade: 1 | 2 | 3 | 4 | 5 | null;
    notLegal: boolean;
    noConcept: boolean;
    side: "left" | "right" | null;
    capacityValue: string | null;
    capacityUnit: string | null;
    measurementValue: string | null;
    measurementUnit: string | null;
    context: string;
    faultTags: string[];
    ratedAt: string;
    sessionDate: string;
  }>;
};

export async function computeSwimmerProgress(swimmerId: string): Promise<SwimmerProgressResponse> {
  // Query A: all ratings (including voided) for computation
  const allRatingRows = await db
    .select({
      slug: skills.slug,
      grade: skillRatings.grade,
      notLegal: skillRatings.notLegal,
      noConcept: skillRatings.noConcept,
      side: skillRatings.side,
      ratedAt: skillRatings.ratedAt,
      voidedAt: skillRatings.voidedAt,
      skillId: skillRatings.skillId,
      sortOrder: skills.sortOrder,
    })
    .from(skillRatings)
    .innerJoin(skills, eq(skills.id, skillRatings.skillId))
    .where(eq(skillRatings.swimmerId, swimmerId));

  const allRatingRecords: RatingRecord[] = allRatingRows.map((row) => ({
    skillSlug: row.slug,
    side: row.side ?? null,
    grade: row.grade as 1 | 2 | 3 | 4 | 5 | null,
    notLegal: row.notLegal,
    noConcept: row.noConcept,
    ratedAt: row.ratedAt.toISOString(),
    voidedAt: row.voidedAt?.toISOString() ?? null,
  }));

  const grades: GradeMap = latestEffectiveRatings(allRatingRecords);

  // Collapse sided-skill keys for graph lookups
  const collapsedGrades: GradeMap = {};
  for (const [key, value] of Object.entries(grades)) {
    if (!key.includes(":")) {
      collapsedGrades[key] = value;
    } else {
      const plainSlug = key.slice(0, key.lastIndexOf(":"));
      if (!(plainSlug in collapsedGrades)) {
        collapsedGrades[plainSlug] = weakerSideGrade(
          grades[`${plainSlug}:left`],
          grades[`${plainSlug}:right`],
        );
      }
    }
  }

  // Load all non-archived skills for start grades, head position, and graph
  const allSkillRows = await db
    .select({
      id: skills.id,
      slug: skills.slug,
      name: skills.name,
      parentSkillId: skills.parentSkillId,
      categoryId: skills.categoryId,
      sortOrder: skills.sortOrder,
    })
    .from(skills)
    .where(isNull(skills.archivedAt));

  // Build slug -> name map for priority name resolution
  const slugToName = new Map(allSkillRows.map((skill) => [skill.slug, skill.name]));

  // Start grades (loop runs after Query B so component current levels use displayRatingRows)
  const startParentRows = allSkillRows.filter((skill) => skill.slug.endsWith("-start"));

  // Head position overall
  const headPositionSlugs = {
    free: "head-position-free",
    back: "head-position-back",
    breast: "head-position-breast",
    fly: "head-position-fly",
  } as const;
  const perStrokeGrades: PerStrokeGrades = {
    ...(collapsedGrades[headPositionSlugs.free] !== undefined && { free: collapsedGrades[headPositionSlugs.free] }),
    ...(collapsedGrades[headPositionSlugs.back] !== undefined && { back: collapsedGrades[headPositionSlugs.back] }),
    ...(collapsedGrades[headPositionSlugs.breast] !== undefined && { breast: collapsedGrades[headPositionSlugs.breast] }),
    ...(collapsedGrades[headPositionSlugs.fly] !== undefined && { fly: collapsedGrades[headPositionSlugs.fly] }),
  };
  const headPosOverall = headPositionOverall(perStrokeGrades);

  // Dependency graph + coaching priorities
  const skillSlugById = new Map(allSkillRows.map((skill) => [skill.id, skill.slug]));
  const depRows = await db
    .select({
      skillId: skillDependencies.skillId,
      dependsOnSkillId: skillDependencies.dependsOnSkillId,
    })
    .from(skillDependencies);

  const graph: BuiltOnGraph = {};
  for (const dep of depRows) {
    const skillSlug = skillSlugById.get(dep.skillId);
    const dependsOnSlug = skillSlugById.get(dep.dependsOnSkillId);
    if (!skillSlug || !dependsOnSlug) continue;
    const existing = graph[skillSlug] ?? [];
    existing.push(dependsOnSlug);
    graph[skillSlug] = existing;
  }

  const fullSortOrder: SortOrderMap = {};
  for (const skill of allSkillRows) {
    fullSortOrder[skill.slug] = skill.sortOrder;
  }

  const coachingPriorities: ProgressCoachingPriority[] = [];
  for (const slug of Object.keys(collapsedGrades)) {
    const chain = findDeepestLowFoundation(slug, collapsedGrades, graph, fullSortOrder);
    if (chain === null) continue;
    const chainWithNames = chain.map((entry) => ({
      slug: entry.slug,
      name: slugToName.get(entry.slug) ?? entry.slug,
      notAssessed: entry.notAssessed,
    }));
    coachingPriorities.push({
      targetSlug: slug,
      targetName: slugToName.get(slug) ?? slug,
      chain: chainWithNames,
    });
  }

  // Sort: not-legal chains first, then lowest effective grade of deepest skill, then catalog sort order
  coachingPriorities.sort((priorityA, priorityB) => {
    const deepestA = priorityA.chain[priorityA.chain.length - 1];
    const deepestB = priorityB.chain[priorityB.chain.length - 1];

    function gradeScore(entry: typeof deepestA): number {
      if (!entry || entry.notAssessed) return 999;
      const grade = collapsedGrades[entry.slug];
      if (grade === "not_legal") return -1;
      if (grade === "no_concept") return 0;
      if (typeof grade === "number") return grade;
      return 999;
    }

    const diff = gradeScore(deepestA) - gradeScore(deepestB);
    if (diff !== 0) return diff;
    return (fullSortOrder[priorityA.targetSlug] ?? 0) - (fullSortOrder[priorityB.targetSlug] ?? 0);
  });

  // Query B: non-voided ratings with session context for the display
  const displayRatingRows = await db
    .select({
      ratingId: skillRatings.id,
      grade: skillRatings.grade,
      notLegal: skillRatings.notLegal,
      noConcept: skillRatings.noConcept,
      side: skillRatings.side,
      capacityValue: skillRatings.capacityValue,
      capacityUnit: skillRatings.capacityUnit,
      measurementValue: skillRatings.measurementValue,
      measurementUnit: skillRatings.measurementUnit,
      ratedAt: skillRatings.ratedAt,
      skillId: skills.id,
      slug: skills.slug,
      skillName: skills.name,
      skillType: skills.type,
      skillUnit: skills.unit,
      ratedPerSide: skills.ratedPerSide,
      sortOrder: skills.sortOrder,
      parentSkillId: skills.parentSkillId,
      categoryId: skillCategories.id,
      categoryName: skillCategories.name,
      context: evaluationSessions.context,
      sessionDate: evaluationSessions.sessionDate,
    })
    .from(skillRatings)
    .innerJoin(skills, eq(skills.id, skillRatings.skillId))
    .innerJoin(skillCategories, eq(skillCategories.id, skills.categoryId))
    .innerJoin(evaluationSessions, eq(evaluationSessions.id, skillRatings.sessionId))
    .where(
      and(
        eq(skillRatings.swimmerId, swimmerId),
        isNull(skillRatings.voidedAt),
      ),
    )
    .orderBy(desc(skillRatings.ratedAt), desc(skillRatings.createdAt), asc(skillRatings.id));

  // Fetch fault tags for displayed ratings
  const displayRatingIds = displayRatingRows.map((row) => row.ratingId);
  const faultTagsMap = new Map<string, string[]>();
  if (displayRatingIds.length > 0) {
    const tagRows = await db
      .select({
        ratingId: ratingFaultTags.ratingId,
        faultTag: ratingFaultTags.faultTag,
      })
      .from(ratingFaultTags)
      .where(inArray(ratingFaultTags.ratingId, displayRatingIds));
    for (const tag of tagRows) {
      const existing = faultTagsMap.get(tag.ratingId) ?? [];
      existing.push(tag.faultTag);
      faultTagsMap.set(tag.ratingId, existing);
    }
  }

  // Build start progress entries using displayRatingRows for component current levels
  const startProgressEntries: StartProgress[] = [];
  for (const startParent of startParentRows) {
    const componentRows = allSkillRows.filter((skill) => skill.parentSkillId === startParent.id);
    if (componentRows.length === 0) continue;
    const componentSlugs = componentRows.map((skill) => skill.slug);
    const startGrade = calculateStartGrade(componentSlugs, allRatingRecords);

    const components = componentRows.map((comp) => {
      const latestDisplay = displayRatingRows.find((row) => row.slug === comp.slug);
      const current: SkillCurrentLevel | null = latestDisplay
        ? {
            grade: latestDisplay.grade as 1 | 2 | 3 | 4 | 5 | null,
            notLegal: latestDisplay.notLegal,
            noConcept: latestDisplay.noConcept,
            capacityValue: latestDisplay.capacityValue ?? null,
            capacityUnit: latestDisplay.capacityUnit as "yards" | "reps" | null,
            measurementValue: latestDisplay.measurementValue ?? null,
            measurementUnit: latestDisplay.measurementUnit as "stroke_cycles_per_minute" | "stroke_count" | "seconds" | "feet" | null,
          }
        : null;
      return { slug: comp.slug, name: comp.name, current };
    });

    startProgressEntries.push({
      slug: startParent.slug,
      name: startParent.name,
      grade: startGrade,
      components,
    });
  }

  // Build per-skill data (ordered by ratedAt desc from query)
  const startParentIds = new Set(startParentRows.map((skill) => skill.id));

  const skillBuckets = new Map<string, SkillBucket>();
  for (const row of displayRatingRows) {
    // Exclude start parent skill entries
    if (startParentIds.has(row.skillId)) continue;

    const existing = skillBuckets.get(row.skillId);
    const point = {
      id: row.ratingId,
      grade: row.grade as 1 | 2 | 3 | 4 | 5 | null,
      notLegal: row.notLegal,
      noConcept: row.noConcept,
      side: (row.side ?? null) as "left" | "right" | null,
      capacityValue: row.capacityValue ?? null,
      capacityUnit: row.capacityUnit ?? null,
      measurementValue: row.measurementValue ?? null,
      measurementUnit: row.measurementUnit ?? null,
      context: row.context,
      faultTags: faultTagsMap.get(row.ratingId) ?? [],
      ratedAt: row.ratedAt.toISOString(),
      sessionDate: row.sessionDate,
    };

    if (existing) {
      existing.points.push(point);
    } else {
      skillBuckets.set(row.skillId, {
        skillId: row.skillId,
        slug: row.slug,
        name: row.skillName,
        categoryId: row.categoryId,
        categoryName: row.categoryName,
        type: row.skillType,
        unit: row.skillUnit ?? null,
        ratedPerSide: row.ratedPerSide,
        parentSkillId: row.parentSkillId ?? null,
        points: [point],
      });
    }
  }

  function toCurrentLevel(point: SkillBucket["points"][number] | undefined): SkillCurrentLevel | null {
    if (!point) return null;
    return {
      grade: point.grade,
      notLegal: point.notLegal,
      noConcept: point.noConcept,
      capacityValue: point.capacityValue,
      capacityUnit: point.capacityUnit as "yards" | "reps" | null,
      measurementValue: point.measurementValue,
      measurementUnit: point.measurementUnit as "stroke_cycles_per_minute" | "stroke_count" | "seconds" | "feet" | null,
    };
  }

  const skillProgressEntries: SwimmerProgressResponse["skills"] = [];
  for (const bucket of skillBuckets.values()) {
    const history = bucket.points.slice(0, 12).map((point) => ({
      id: point.id,
      grade: point.grade,
      notLegal: point.notLegal,
      noConcept: point.noConcept,
      side: point.side,
      capacityValue: point.capacityValue,
      capacityUnit: point.capacityUnit as "yards" | "reps" | null,
      measurementValue: point.measurementValue,
      measurementUnit: point.measurementUnit as "stroke_cycles_per_minute" | "stroke_count" | "seconds" | "feet" | null,
      context: point.context as "drill" | "practice" | "race",
      faultTags: point.faultTags,
      ratedAt: point.ratedAt,
      sessionDate: point.sessionDate,
    }));

    if (bucket.ratedPerSide) {
      const latestLeft = bucket.points.find((point) => point.side === "left");
      const latestRight = bucket.points.find((point) => point.side === "right");
      skillProgressEntries.push({
        skillId: bucket.skillId,
        slug: bucket.slug,
        name: bucket.name,
        categoryId: bucket.categoryId,
        categoryName: bucket.categoryName,
        type: bucket.type as "rubric" | "measured" | "score" | "composite" | "rollup",
        unit: bucket.unit,
        ratedPerSide: true,
        parentSkillId: bucket.parentSkillId,
        current: null,
        currentLeft: toCurrentLevel(latestLeft),
        currentRight: toCurrentLevel(latestRight),
        history,
      });
    } else {
      skillProgressEntries.push({
        skillId: bucket.skillId,
        slug: bucket.slug,
        name: bucket.name,
        categoryId: bucket.categoryId,
        categoryName: bucket.categoryName,
        type: bucket.type as "rubric" | "measured" | "score" | "composite" | "rollup",
        unit: bucket.unit,
        ratedPerSide: false,
        parentSkillId: bucket.parentSkillId,
        current: toCurrentLevel(bucket.points[0]),
        currentLeft: null,
        currentRight: null,
        history,
      });
    }
  }

  return {
    skills: skillProgressEntries,
    startProgress: startProgressEntries,
    headPositionOverall: headPosOverall,
    coachingPriorities,
  };
}
