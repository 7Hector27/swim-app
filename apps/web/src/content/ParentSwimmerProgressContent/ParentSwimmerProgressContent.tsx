import type {
  ParentCategoriesResponse,
  ParentSwimmer,
  ParentSwimmerProgressResponse,
  ParentScoreHistoryResponse,
} from "@swim-app/shared";
import CategoryTrendsGrid from "@/components/CategoryTrendsGrid";
import InlineError from "@/components/InlineError";
import StartLadderCard from "@/components/StartLadderCard";
import {
  screenGroupTrendSeries,
  startSeries,
} from "@/lib/progressCharts";
import ParentStrokeGroupsPanel from "./ParentStrokeGroupsPanel";
import {
  formatProgressSessionDate,
} from "./helpers";

// Per-section failure flags. `progress` is primary (the page throws if it
// fails), so it isn't listed. Defaults to all false, keeping existing tests
// that don't pass this prop green.
export interface ParentSwimmerProgressSectionFailures {
  categories?: boolean;
  scoreHistory?: boolean;
}

interface ParentSwimmerProgressContentProps {
  swimmer: ParentSwimmer;
  progress: ParentSwimmerProgressResponse;
  categories: ParentCategoriesResponse;
  // Charts need an oldest-to-newest set of session-level snapshots. The
  // backend always sends one (empty when the swimmer has no evaluations); the
  // prop is optional only so existing unit tests that pre-date the charts
  // don't have to be rewritten for the empty case.
  scoreHistory?: ParentScoreHistoryResponse;
  sectionFailures?: ParentSwimmerProgressSectionFailures;
}

const EMPTY_SCORE_HISTORY: ParentScoreHistoryResponse = {
  points: [],
  recentChanges: [],
  milestones: [],
  measurements: [],
};

export default function ParentSwimmerProgressContent({
  swimmer,
  progress,
  categories,
  scoreHistory = EMPTY_SCORE_HISTORY,
  sectionFailures = {},
}: ParentSwimmerProgressContentProps) {
  // Pass 3: trend grid buckets by evaluate-screen groups now.
  const categoryTrends = screenGroupTrendSeries(scoreHistory);
  const startTrends = startSeries(scoreHistory);
  const totalPoints = scoreHistory.points.length;
  const hasEnoughForTrend = totalPoints >= 2;

  // Start components don't appear in SCREEN_SECTIONS so they can't surface
  // as rows in a group — drop them from the input list anyway to keep
  // the panel's work tight. Start parents stay: the panel synthesizes a
  // composite row for each one so the Starts section inside the Starts-
  // and-turns group has entries even though progress.skills never
  // contains a composite parent directly.
  const startComponentSlugs = new Set(
    progress.startProgress.flatMap((start) => start.components.map((component) => component.slug)),
  );

  const displaySkills = progress.skills.filter(
    (skill) => !startComponentSlugs.has(skill.slug),
  );

  // Pass 3: switcher-driven groups instead of per-category collapsibles.
  // Latest session's rollups drive the switcher badges + the header count.
  const latestScreenGroupRollups =
    scoreHistory.points[scoreHistory.points.length - 1]?.screenGroupRollups ?? [];
  // Server-rendered now; pin to ISO so recency text matches during hydration.
  const nowIso = new Date().toISOString();

  const hasAnyData =
    progress.skills.length > 0 ||
    progress.startProgress.some(
      (start) => start.grade.status !== "in_progress" || start.components.some((component) => component.current !== null),
    );

  const failedSections: string[] = [];
  if (sectionFailures.categories) failedSections.push("skill categories");
  if (sectionFailures.scoreHistory) failedSections.push("score history");

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

          {failedSections.length > 0 && (
            <InlineError
              message={`Couldn't load ${failedSections.join(", ")}. The rest of the page is current.`}
              reloadOnRetry
            />
          )}

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

          {/* Group trends over time. Only renders when there are two or
              more non-voided evaluations (otherwise every mini-line would be
              a dot and the section would read as empty). */}
          {hasEnoughForTrend && categoryTrends.length > 0 && (
            <section
              className="flex flex-col gap-3"
              data-testid="parent-progress-category-trends"
            >
              <h2 className="font-bold text-sm text-text">Group trends</h2>
              <CategoryTrendsGrid categories={categoryTrends} />
            </section>
          )}

          {/* Starts */}
          {progress.startProgress.length > 0 && (
            <section className="flex flex-col gap-3" data-testid="parent-progress-starts">
              <h2 className="font-bold text-sm text-text">
                Starts
              </h2>
              <div className="grid gap-4 tablet:grid-cols-2 desktop:grid-cols-3">
                {progress.startProgress.map((start) => {
                  const historyEntry = startTrends.find((entry) => entry.slug === start.slug);
                  return (
                    <StartLadderCard
                      key={start.slug}
                      name={start.name}
                      grade={start.grade}
                      components={start.components}
                      history={historyEntry?.points ?? []}
                    />
                  );
                })}
              </div>
            </section>
          )}

          {/* Pass 3: screen-group switcher replaces per-category
              collapsibles. One group visible at a time. Rows show
              "Not rated yet" and the 6-week stale grey-out in
              ParentSkillProgressRow. */}
          <ParentStrokeGroupsPanel
            skills={displaySkills}
            startProgress={progress.startProgress}
            categories={categories}
            nowIso={nowIso}
            rollups={latestScreenGroupRollups}
          />
        </div>
      </main>
    </div>
  );
}
