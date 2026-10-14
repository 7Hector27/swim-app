// Grade values a skill rating can carry.
// null means "not assessed" (no rating row exists) or "voided" (treated identically).
export type SkillGrade = 1 | 2 | 3 | 4 | 5 | "not_legal" | "no_concept" | null;

// slug → builtOnSlugs from the skills catalog
export type BuiltOnGraph = Record<string, string[]>;

// slug → current (non-voided) grade for a swimmer; omitted keys are treated as null
export type GradeMap = Record<string, SkillGrade>;

// Returns a number for sorting: not_legal and no_concept → 0, null → -1 (never low),
// numeric grades as-is. Lower is worse.
function numericGrade(grade: SkillGrade): number {
  if (grade === "not_legal" || grade === "no_concept") return 0;
  if (grade === null) return -1;
  return grade;
}

// Exclusion rules (from evaluations plan PR E-0):
//   null (not assessed / voided) → not low; chain stops here
//   not_legal                    → always low
//   no_concept                   → always low
//   grade ≤ 2                    → absolute low
//   grade < supporterGrade       → relative low (lower than the skill it supports)
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

// Walk the buildsOn chain from targetSlug and return the slug of the deepest low
// foundation skill. Starts with the target itself; if any of its foundations are
// low, descends into the worst one (lowest effective grade) and repeats.
// Stops when no foundation is low or a foundation is not assessed (null).
// Returns the target slug unchanged when it has no low foundations.
export function findDeepestLowFoundation(
  targetSlug: string,
  grades: GradeMap,
  graph: BuiltOnGraph,
): string {
  const visited = new Set<string>();

  function descend(slug: string): string {
    if (visited.has(slug)) return slug;
    visited.add(slug);

    const currentGrade = grades[slug] ?? null;
    const foundations = graph[slug] ?? [];

    let bestSlug: string | null = null;
    let bestNumeric = Infinity;

    for (const foundationSlug of foundations) {
      const foundationGrade = grades[foundationSlug] ?? null;
      if (!isLow(foundationGrade, currentGrade)) continue;

      const numeric = numericGrade(foundationGrade);
      if (numeric < bestNumeric) {
        bestNumeric = numeric;
        bestSlug = foundationSlug;
      }
    }

    return bestSlug === null ? slug : descend(bestSlug);
  }

  return descend(targetSlug);
}
