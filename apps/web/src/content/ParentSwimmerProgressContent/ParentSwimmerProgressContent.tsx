import type {
  CategoriesResponse,
  ParentSwimmer,
  ParentSwimmerProgressResponse,
  ScoreHistoryResponse,
  StartGradeResult,
} from "@swim-app/shared";
import CategoryTrendsGrid from "@/components/CategoryTrendsGrid";
import CollapsibleCategory from "@/components/CollapsibleCategory";
import StartProgression from "@/components/StartProgression";
import {
  categoryTrendSeries,
  startSeries,
} from "@/lib/progressCharts";
import ParentSkillProgressRow from "./ParentSkillProgressRow";
import {
  formatProgressSessionDate,
  formatStartGradeDisplay,
  currentLevelDisplay,
  currentLevelIsDanger,
} from "./helpers";

interface ParentSwimmerProgressContentProps {
  swimmer: ParentSwimmer;
  progress: ParentSwimmerProgressResponse;
  categories: CategoriesResponse;
  // Charts need an oldest-to-newest set of session-level snapshots. The
  // backend always sends one (empty when the swimmer has no evaluations); the
  // prop is optional only so existing unit tests that pre-date the charts
  // don't have to be rewritten for the empty case.
  scoreHistory?: ScoreHistoryResponse;
}

const EMPTY_SCORE_HISTORY: ScoreHistoryResponse = {
  points: [],
  recentChanges: [],
  milestones: [],
  faultTrends: [],
  measurements: [],
};

function startGradeIsDanger(result: StartGradeResult): boolean {
  return result.status === "not_legal";
}

export default function ParentSwimmerProgressContent({
  swimmer,
  progress,
  categories,
  scoreHistory = EMPTY_SCORE_HISTORY,
}: ParentSwimmerProgressContentProps) {
  const categoryTrends = categoryTrendSeries(scoreHistory);
  const startTrends = startSeries(scoreHistory);
  const totalPoints = scoreHistory.points.length;
  const hasEnoughForTrend = totalPoints >= 2;
  const slugToName = new Map<string, string>();
  for (const cat of categories) {
    for (const skill of cat.skills) {
      slugToName.set(skill.slug, skill.name);
    }
  }
  for (const skill of progress.skills) {
    slugToName.set(skill.slug, skill.name);
  }
  for (const start of progress.startProgress) {
    slugToName.set(start.slug, start.name);
    for (const comp of start.components) {
      slugToName.set(comp.slug, comp.name);
    }
  }

  const getSlugName = (slug: string): string => slugToName.get(slug) ?? slug;

  const startParentSlugs = new Set(progress.startProgress.map((start) => start.slug));
  const startComponentSlugs = new Set(
    progress.startProgress.flatMap((start) => start.components.map((component) => component.slug)),
  );

  const displaySkills = progress.skills.filter(
    (skill) => !startParentSlugs.has(skill.slug) && !startComponentSlugs.has(skill.slug),
  );

  const categoryOrder = categories.map((category) => category.id);
  const skillsByCategory = new Map<string, { categoryName: string; skills: typeof displaySkills }>();

  for (const skill of displaySkills) {
    const existing = skillsByCategory.get(skill.categoryId);
    if (existing) {
      existing.skills.push(skill);
    } else {
      skillsByCategory.set(skill.categoryId, { categoryName: skill.categoryName, skills: [skill] });
    }
  }

  for (const cat of categories) {
    if (!skillsByCategory.has(cat.id) && cat.skills.length > 0) {
      skillsByCategory.set(cat.id, { categoryName: cat.name, skills: [] });
    }
  }

  const orderedCategories = [
    ...categoryOrder
      .filter((id) => skillsByCategory.has(id))
      .map((id) => ({ id, ...skillsByCategory.get(id)! })),
    ...[...skillsByCategory.entries()]
      .filter(([id]) => !categoryOrder.includes(id))
      .map(([id, data]) => ({ id, ...data })),
  ];

  const hasAnyData =
    progress.skills.length > 0 ||
    progress.startProgress.some(
      (start) => start.grade.status !== "in_progress" || start.components.some((component) => component.current !== null),
    );

  return (
    <div className="flex flex-col flex-1">
      <main className="flex-1 px-page pt-8 pb-20 tablet:pb-8">
        <div className="mx-auto max-w-content flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <a
              href="/dashboard"
              className="text-sm underline text-link"
            >
              ← Dashboard
            </a>
            <h1 className="text-heading text-text">
              {swimmer.firstName}&apos;s Progress
            </h1>
          </div>

          {!hasAnyData && (
            <p className="text-sm text-text-secondary">
              No evaluations recorded yet. Check back after the next practice session.
            </p>
          )}

          {/* Current focus (coach's own words from the most recent non-voided
              evaluation with a priority). Hidden entirely when no priority has
              ever been written. */}
          {progress.latestCoachingPriority && (
            <section
              className="flex flex-col gap-2 rounded-card border border-border p-4"
              data-testid="parent-progress-current-focus"
            >
              <h2 className="font-bold text-sm text-text">Current focus</h2>
              <p className="text-sm text-text">{progress.latestCoachingPriority.text}</p>
              <p className="text-xs text-text-secondary">
                From {formatProgressSessionDate(progress.latestCoachingPriority.sessionDate)}
              </p>
            </section>
          )}

          {/* What to work on next */}
          {progress.coachingPriorities.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="font-bold text-sm text-text">
                What to work on next
              </h2>
              <ul className="flex flex-col gap-2">
                {progress.coachingPriorities.slice(0, 3).map((priority) => {
                  const deepest = priority.chain[priority.chain.length - 1];
                  return (
                    <li key={priority.targetSlug} className="text-sm text-text">
                      <span className="font-semibold">{priority.targetName}</span>
                      {deepest && deepest.slug !== priority.targetSlug && (
                        <>
                          {" → "}
                          <span>
                            {priority.chain.map((entry, index) => (
                              <span key={entry.slug}>
                                {index > 0 && " → "}
                                <span style={entry.notAssessed ? { color: "var(--color-text-secondary)" } : undefined}>
                                  {entry.name}
                                  {entry.notAssessed ? " (not assessed yet — check it)" : ""}
                                </span>
                              </span>
                            ))}
                          </span>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {/* Category trends over time. Only renders when there are two or
              more non-voided evaluations (otherwise every mini-line would be
              a dot and the section would read as empty). */}
          {hasEnoughForTrend && categoryTrends.length > 0 && (
            <section
              className="flex flex-col gap-3"
              data-testid="parent-progress-category-trends"
            >
              <h2 className="font-bold text-sm text-text">Category trends</h2>
              <CategoryTrendsGrid categories={categoryTrends} />
            </section>
          )}

          {/* Starts */}
          {progress.startProgress.length > 0 && (
            <section className="flex flex-col gap-3" data-testid="parent-progress-starts">
              <h2 className="font-bold text-sm text-text">
                Starts
              </h2>
              <ul className="flex flex-col gap-3">
                {progress.startProgress.map((start) => {
                  const gradeText = formatStartGradeDisplay(start.grade, getSlugName);
                  const isDanger = startGradeIsDanger(start.grade);
                  const trend = startTrends.find((entry) => entry.slug === start.slug);
                  return (
                    <li key={start.slug} className="flex flex-col gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-text">
                          {start.name}
                        </span>
                        <span
                          className="text-xs font-semibold px-1.5 py-0.5 rounded"
                          style={{
                            backgroundColor: isDanger ? "var(--color-danger)" : "var(--color-border)",
                            color: isDanger ? "var(--color-on-danger)" : "var(--color-text)",
                          }}
                        >
                          {gradeText}
                        </span>
                      </div>
                      <ul className="flex flex-col gap-0.5 pl-3 border-l border-border">
                        {start.components.map((comp) => (
                          <li key={comp.slug} className="flex items-center gap-2 text-xs">
                            <span className="text-text-secondary flex-1">{comp.name}</span>
                            {comp.current !== null ? (
                              <span
                                className="font-semibold px-1 py-0.5 rounded"
                                style={{
                                  backgroundColor: currentLevelIsDanger(comp.current)
                                    ? "var(--color-danger)"
                                    : "var(--color-border)",
                                  color: currentLevelIsDanger(comp.current)
                                    ? "var(--color-on-danger)"
                                    : "var(--color-text)",
                                }}
                              >
                                {currentLevelDisplay(comp.current)}
                              </span>
                            ) : (
                              <span className="text-text-secondary">Not assessed</span>
                            )}
                          </li>
                        ))}
                      </ul>
                      {trend && hasEnoughForTrend && (
                        <StartProgression name={start.name} points={trend.points} />
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {/* Category skill cards. Collapsed by default; a #skill-<slug>
              hash on page load opens the matching category and scrolls to
              the row. */}
          {orderedCategories.map(({ id, categoryName, skills: catSkills }) => {
            const assessedIds = new Set(catSkills.map((skill) => skill.skillId));
            const catFromCategories = categories.find((category) => category.id === id);

            const notAssessedSkills = catFromCategories
              ? catFromCategories.skills.filter(
                  (skill) =>
                    !assessedIds.has(skill.id) &&
                    !startParentSlugs.has(skill.slug) &&
                    !startComponentSlugs.has(skill.slug),
                )
              : [];

            const categorySlugs = [
              ...catSkills.map((skill) => skill.slug),
              ...notAssessedSkills.map((skill) => skill.slug),
            ];

            return (
              <CollapsibleCategory
                key={id}
                className="group flex flex-col gap-2"
                categorySlugs={categorySlugs}
                summaryClassName="font-bold text-sm text-text cursor-pointer list-none flex items-center gap-2 min-h-[44px]"
                summary={(
                  <>
                    <span aria-hidden="true" className="transition-transform duration-200 group-open:rotate-90">
                      ›
                    </span>
                    <span>{categoryName}</span>
                    <span className="text-xs font-normal text-text-secondary ml-auto">
                      {catSkills.length} assessed
                    </span>
                  </>
                )}
              >
                <ul className="flex flex-col gap-0">
                  {catSkills.map((skill) => (
                    <ParentSkillProgressRow key={skill.skillId} skill={skill} />
                  ))}
                  {notAssessedSkills.map((skill) => (
                    <li
                      key={skill.id}
                      id={`skill-${skill.slug}`}
                      className="flex items-center justify-between border-b border-border py-2 text-sm min-h-[44px] scroll-mt-24"
                    >
                      <span className="text-text">{skill.name}</span>
                      <span className="text-xs text-text-secondary">Not assessed</span>
                    </li>
                  ))}
                </ul>
              </CollapsibleCategory>
            );
          })}
        </div>
      </main>
    </div>
  );
}
