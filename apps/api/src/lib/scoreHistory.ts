import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/client";
import {
  evaluationSessions,
  meetSwims,
  meets,
  skillCategories,
  skillDependencies,
  skillRatings,
  skills,
} from "../db/schema";
import {
  calculateStartGrade,
  headPositionOverall,
  latestEffectiveRatings,
  weakerSideGrade,
  MASTERY_LEVEL,
  type GradeMap,
  type PerStrokeGrades,
  type RatingRecord,
  type ScoreHistoryResponse,
  type ScoreHistoryPoint,
  type ScoreHistoryCategoryRollup,
  type ScoreHistoryStart,
  type ScoreHistoryLevelCounts,
  type ScoreHistoryMilestone,
  type ScoreHistoryRecentChange,
  type SkillGrade,
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

// Numeric value of a SkillGrade for arithmetic (gain summation, mastery check).
// Returns null for anything that isn't a plain 1..5 — not_legal, no_concept,
// and null all read as "not a progress-countable level."
function numericGrade(grade: SkillGrade | undefined): number | null {
  if (grade === undefined || grade === null) return null;
  if (grade === "not_legal" || grade === "no_concept") return null;
  return grade;
}

function emptyLevelCounts(): ScoreHistoryLevelCounts {
  return { level1: 0, level2: 0, level3: 0, level4: 0, level5: 0, notLegal: 0, noConcept: 0 };
}

function tallyLevel(counts: ScoreHistoryLevelCounts, grade: SkillGrade | undefined): void {
  if (grade === undefined || grade === null) return;
  if (grade === "not_legal") counts.notLegal += 1;
  else if (grade === "no_concept") counts.noConcept += 1;
  else if (grade === 1) counts.level1 += 1;
  else if (grade === 2) counts.level2 += 1;
  else if (grade === 3) counts.level3 += 1;
  else if (grade === 4) counts.level4 += 1;
  else if (grade === 5) counts.level5 += 1;
}

// Ordering for change detection between two SkillGrades. Returns 0 when the
// two states are equal, a positive number when `after` is better, negative
// when worse. `no_concept` and `not_legal` aren't on the 1..5 scale, so we
// treat them as "below 1" by convention — a move from `not_legal` to a
// numeric grade is a level-up, a move from numeric to `not_legal` is a drop.
function gradeRank(grade: SkillGrade): number {
  if (grade === null) return -Infinity;
  if (grade === "no_concept") return 0;
  if (grade === "not_legal") return 0.5;
  return grade;
}

type FullRow = {
  slug: string;
  skillName: string;
  grade: number | null;
  notLegal: boolean;
  noConcept: boolean;
  side: "left" | "right" | null;
  ratedAt: Date;
  voidedAt: Date | null;
  supersededAt: Date | null;
  sessionId: string;
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
      skillName: skills.name,
      grade: skillRatings.grade,
      notLegal: skillRatings.notLegal,
      noConcept: skillRatings.noConcept,
      side: skillRatings.side,
      ratedAt: skillRatings.ratedAt,
      voidedAt: skillRatings.voidedAt,
      supersededAt: skillRatings.supersededAt,
      sessionId: skillRatings.sessionId,
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

  // Primary session per date: newest createdAt wins when multiple sessions
  // share a sessionDate. Lets the chart's "Edit this evaluation" link target
  // one specific session id (ADR 032).
  const sessionDateRows = await db
    .select({
      id: evaluationSessions.id,
      sessionDate: evaluationSessions.sessionDate,
      createdAt: evaluationSessions.createdAt,
    })
    .from(evaluationSessions)
    .where(eq(evaluationSessions.swimmerId, swimmerId));
  const primarySessionIdByDate = new Map<string, { id: string; createdAt: Date }>();
  for (const row of sessionDateRows) {
    const existing = primarySessionIdByDate.get(row.sessionDate);
    if (!existing || row.createdAt.getTime() > existing.createdAt.getTime()) {
      primarySessionIdByDate.set(row.sessionDate, { id: row.id, createdAt: row.createdAt });
    }
  }

  // Baseline per plain slug: the first collapsed grade that slug ever had.
  // Built by walking dates in ascending order and recording the first time
  // each slug appears in the collapsed GradeMap. This becomes the reference
  // for "levels gained" and the "no concept / unrated → learned" transition.
  const firstCollapsedGradeBySlug = new Map<string, SkillGrade>();
  const collapsedByDate = new Map<string, GradeMap>();
  for (const date of sortedDates) {
    const asOfRecords = ratingRows
      .filter((row) => row.sessionDate <= date)
      .map(rowToRecord);
    const collapsed = collapseSidedGrades(latestEffectiveRatings(asOfRecords));
    collapsedByDate.set(date, collapsed);
    for (const [slug, grade] of Object.entries(collapsed)) {
      if (!firstCollapsedGradeBySlug.has(slug)) {
        firstCollapsedGradeBySlug.set(slug, grade);
      }
    }
  }

  const points: ScoreHistoryPoint[] = [];
  for (const date of sortedDates) {
    const asOfRecords: RatingRecord[] = ratingRows
      .filter((row) => row.sessionDate <= date)
      .map(rowToRecord);

    const grades = latestEffectiveRatings(asOfRecords);
    const collapsed = collapsedByDate.get(date) ?? collapseSidedGrades(grades);

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

    // Progression tallies. Scanned over the collapsed GradeMap so counts
    // live at the per-skill granularity, not per-rating.
    const counts = emptyLevelCounts();
    let totalLevelsGained = 0;
    let skillsMastered = 0;
    let skillsLearned = 0;
    for (const [slug, grade] of Object.entries(collapsed)) {
      tallyLevel(counts, grade);
      const numeric = numericGrade(grade);
      if (numeric !== null && numeric >= MASTERY_LEVEL) skillsMastered += 1;
      const baseline = firstCollapsedGradeBySlug.get(slug);
      const baselineNumeric = numericGrade(baseline);
      if (numeric !== null && baselineNumeric !== null && numeric > baselineNumeric) {
        totalLevelsGained += numeric - baselineNumeric;
      }
      // "Learned": the swimmer has reached a numeric 1..5 grade on this
      // skill. Prior state before any rating is "unrated" (absent from the
      // map), so hitting numeric is itself the transition. not_legal and
      // no_concept don't count as learned; a numeric grade later does.
      if (numeric !== null) skillsLearned += 1;
    }

    // Every date in sortedDates came from a non-voided rating, so the
    // session row must exist. Fall back to the empty string if a race ever
    // drops it — the chart's deep link will 404 on the server rather than
    // silently misroute to another swimmer's session.
    const primary = primarySessionIdByDate.get(date);
    points.push({
      sessionDate: date,
      sessionId: primary?.id ?? "",
      headPositionOverall: headPosOverall,
      categoryRollups,
      starts: startEntries,
      counts,
      totalLevelsGained,
      skillsMastered,
      skillsLearned,
    });
  }

  // Recent effective-grade changes across all (skill, side) keys. Walks each
  // key's non-voided, non-superseded ratings in temporal order and emits a
  // transition when the SkillGrade changes. Equal consecutive grades don't
  // emit. First-ever ratings don't emit (first-rated transitions are a
  // milestone, not a change). Capped at the 20 newest by sessionDate.
  const liveRatings = ratingRows.filter((row) => row.voidedAt === null && row.supersededAt === null);
  const byKey = new Map<string, FullRow[]>();
  for (const row of liveRatings) {
    const key = row.side !== null ? `${row.slug}:${row.side}` : row.slug;
    const existing = byKey.get(key);
    if (existing) existing.push(row);
    else byKey.set(key, [row]);
  }
  const allChanges: ScoreHistoryRecentChange[] = [];
  for (const [, rows] of byKey) {
    rows.sort((rowA, rowB) => rowA.ratedAt.getTime() - rowB.ratedAt.getTime());
    for (let index = 1; index < rows.length; index++) {
      const previous = rows[index - 1]!;
      const current = rows[index]!;
      const fromGrade = rowToSkillGrade(previous);
      const toGrade = rowToSkillGrade(current);
      if (fromGrade === null || toGrade === null) continue;
      if (gradesEqual(fromGrade, toGrade)) continue;
      const direction = gradeRank(toGrade) >= gradeRank(fromGrade) ? "up" : "down";
      allChanges.push({
        skillSlug: current.slug,
        skillName: current.skillName,
        side: current.side,
        fromGrade,
        toGrade,
        direction,
        sessionDate: current.sessionDate,
        sessionId: current.sessionId,
      });
    }
  }
  allChanges.sort((changeA, changeB) => {
    if (changeA.sessionDate !== changeB.sessionDate) {
      return changeA.sessionDate < changeB.sessionDate ? 1 : -1;
    }
    return changeA.skillName.localeCompare(changeB.skillName);
  });
  const recentChanges = allChanges.slice(0, 20);

  // Milestones. Walks dates in ascending order and emits each milestone the
  // first time its criterion is satisfied, so a swimmer sees at most one of
  // each (type, subject) pair. Rating-based milestones (legal / learned /
  // mastered / unlocked) share the per-date collapsedByDate map so they drop
  // voided and superseded rows exactly like the counts above. Personal-best
  // milestones come from a separate meet-swim stream and use the meet's
  // swumOn date as their sessionDate.
  const milestones: ScoreHistoryMilestone[] = [];

  const nameBySlug = new Map(allSkillRows.map((row) => [row.slug, row.name]));
  const slugById = new Map(allSkillRows.map((row) => [row.id, row.slug]));
  const depRows = await db
    .select({
      skillId: skillDependencies.skillId,
      dependsOnSkillId: skillDependencies.dependsOnSkillId,
    })
    .from(skillDependencies);
  const prereqSlugsBySlug = new Map<string, string[]>();
  for (const row of depRows) {
    const childSlug = slugById.get(row.skillId);
    const prereqSlug = slugById.get(row.dependsOnSkillId);
    if (!childSlug || !prereqSlug) continue;
    const existing = prereqSlugsBySlug.get(childSlug);
    if (existing) existing.push(prereqSlug);
    else prereqSlugsBySlug.set(childSlug, [prereqSlug]);
  }

  const seenLearned = new Set<string>();
  const everNotLegal = new Set<string>();
  const seenLegal = new Set<string>();
  const seenMastered = new Set<string>();
  const seenUnlocked = new Set<string>();

  for (const date of sortedDates) {
    const collapsed = collapsedByDate.get(date) ?? {};
    const primarySessionId = primarySessionIdByDate.get(date)?.id ?? "";

    for (const [slug, grade] of Object.entries(collapsed)) {
      if (grade === "not_legal") everNotLegal.add(slug);
      const numeric = numericGrade(grade);
      const skillName = nameBySlug.get(slug) ?? slug;

      if (numeric !== null && everNotLegal.has(slug) && !seenLegal.has(slug)) {
        milestones.push({
          type: "skill_legal",
          sessionDate: date,
          sessionId: primarySessionId,
          skillSlug: slug,
          skillName,
        });
        seenLegal.add(slug);
      }

      if (numeric !== null && !seenLearned.has(slug)) {
        milestones.push({
          type: "skill_learned",
          sessionDate: date,
          sessionId: primarySessionId,
          skillSlug: slug,
          skillName,
        });
        seenLearned.add(slug);
      }

      if (numeric !== null && numeric >= MASTERY_LEVEL && !seenMastered.has(slug)) {
        milestones.push({
          type: "skill_mastered",
          sessionDate: date,
          sessionId: primarySessionId,
          skillSlug: slug,
          skillName,
        });
        seenMastered.add(slug);
      }
    }

    // Prereq-driven unlocks: emit for every catalog skill whose declared
    // prerequisites are now all at numeric 1..5. Independent of whether the
    // dependent skill itself has been rated — the milestone is the gate
    // opening, not the first swim through it.
    for (const [childSlug, prereqSlugs] of prereqSlugsBySlug) {
      if (seenUnlocked.has(childSlug)) continue;
      const allMet = prereqSlugs.every(
        (prereqSlug) => numericGrade(collapsed[prereqSlug]) !== null,
      );
      if (allMet) {
        milestones.push({
          type: "skill_unlocked",
          sessionDate: date,
          sessionId: primarySessionId,
          skillSlug: childSlug,
          skillName: nameBySlug.get(childSlug) ?? childSlug,
        });
        seenUnlocked.add(childSlug);
      }
    }
  }

  // Personal bests: walk meet swims chronologically and emit on every new
  // minimum per (eventDistance, eventStroke, course). The first time an
  // event is swum counts as a PB — there's no earlier time to beat.
  const meetSwimRows = await db
    .select({
      eventDistance: meetSwims.eventDistance,
      eventStroke: meetSwims.eventStroke,
      course: meetSwims.course,
      swumOn: meetSwims.swumOn,
      timeHundredths: meetSwims.timeHundredths,
      createdAt: meetSwims.createdAt,
      meetName: meets.name,
    })
    .from(meetSwims)
    .leftJoin(meets, eq(meets.id, meetSwims.meetId))
    .where(and(eq(meetSwims.swimmerId, swimmerId), eq(meetSwims.swimType, "meet")));
  meetSwimRows.sort((rowA, rowB) => {
    if (rowA.swumOn !== rowB.swumOn) return rowA.swumOn < rowB.swumOn ? -1 : 1;
    return rowA.createdAt.getTime() - rowB.createdAt.getTime();
  });
  const bestTimeByEvent = new Map<string, number>();
  for (const row of meetSwimRows) {
    const key = `${row.eventDistance}|${row.eventStroke}|${row.course}`;
    const previous = bestTimeByEvent.get(key);
    if (previous === undefined || row.timeHundredths < previous) {
      bestTimeByEvent.set(key, row.timeHundredths);
      milestones.push({
        type: "personal_best",
        sessionDate: row.swumOn,
        eventDistance: row.eventDistance,
        eventStroke: row.eventStroke,
        course: row.course,
        timeHundredths: row.timeHundredths,
        meetName: row.meetName,
      });
    }
  }

  // Newest first with a deterministic tiebreak so repeat queries render in
  // the same order even when several milestones land on one date.
  milestones.sort((milestoneA, milestoneB) => {
    if (milestoneA.sessionDate !== milestoneB.sessionDate) {
      return milestoneA.sessionDate < milestoneB.sessionDate ? 1 : -1;
    }
    if (milestoneA.type !== milestoneB.type) {
      return milestoneA.type.localeCompare(milestoneB.type);
    }
    const keyA = milestoneA.type === "personal_best"
      ? `${milestoneA.eventStroke}|${milestoneA.eventDistance}|${milestoneA.course}`
      : milestoneA.skillSlug;
    const keyB = milestoneB.type === "personal_best"
      ? `${milestoneB.eventStroke}|${milestoneB.eventDistance}|${milestoneB.course}`
      : milestoneB.skillSlug;
    return keyA.localeCompare(keyB);
  });

  return { points, recentChanges, milestones };
}

function rowToSkillGrade(row: FullRow): SkillGrade {
  if (row.notLegal) return "not_legal";
  if (row.noConcept) return "no_concept";
  return (row.grade as 1 | 2 | 3 | 4 | 5 | null);
}

function gradesEqual(gradeA: SkillGrade, gradeB: SkillGrade): boolean {
  return gradeA === gradeB;
}
