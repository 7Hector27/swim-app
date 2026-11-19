import type {
  ParentCategoriesResponse,
  ParentScoreHistoryResponse,
  ParentSkillProgress,
  ParentSwimmer,
  ParentSwimmerProgressResponse,
} from "@swim-app/shared";
import InlineError from "@/components/InlineError";
import StartsSection from "@/components/StartsSection";
import CategoryRadar from "@/content/SwimmerProgressContent/charts/CategoryRadar";
import { firstScreenGroupSnapshot, latestScreenGroupSnapshot } from "@/lib/progressCharts";
import { buildCatalogIndex } from "@/lib/screenGroups";
import ParentStrokeGroupsPanel from "./ParentStrokeGroupsPanel";
import CoachFocus from "./sections/CoachFocus";
import RecentWins from "./sections/RecentWins";
import SummaryCard from "./sections/SummaryCard";
import { buildRecentWins, buildSummaryCard } from "./helpers";

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

// Rebuilt to match docs/design/parent-progress-page-mock.html. Composes
// seven sections, each with its own component:
//
//   1. Summary tiles (levels gained, last evaluated, evaluations this season)
//   2. Coach's focus (latest priority + "Working on next" list)
//   3. Recent wins (up to three positive events from the ratings)
//   4. Snapshot — radar across the nine evaluate-screen groups
//   5. Skills — group switcher + rows (ParentStrokeGroupsPanel, which
//      renders the mock's pip-row via the rewritten ParentSkillProgressRow)
//   6. Starts — shared StartsSection, parent variant hides the session
//      grid and the Still-to-grade tile
//   7. Golf score — deferred (parent progress response doesn't currently
//      ship golf data; flagged in the commit notes for the next pass)
//
// Phone-first layout: every section stacks vertically. On tablet+ a
// few sections flow into a two-column grid where it reads well.
export default function ParentSwimmerProgressContent({
  swimmer,
  progress,
  categories,
  scoreHistory = EMPTY_SCORE_HISTORY,
  sectionFailures = {},
}: ParentSwimmerProgressContentProps) {
  const categorySnapshot = latestScreenGroupSnapshot(scoreHistory);
  const firstSnapshot = firstScreenGroupSnapshot(scoreHistory);

  // Start-component skills shouldn't appear as rows in the group listing;
  // their data lives inside the Starts section.
  const startComponentSlugs = new Set(
    progress.startProgress.flatMap((start) => start.components.map((component) => component.slug)),
  );
  const displaySkills = progress.skills.filter((skill) => !startComponentSlugs.has(skill.slug));

  const latestScreenGroupRollups =
    scoreHistory.points[scoreHistory.points.length - 1]?.screenGroupRollups ?? [];

  // Server-rendered now; pin to ISO so stale-row calculations hold across
  // SSR + hydration.
  const nowIso = new Date().toISOString();

  // Shared catalog index: lets the summary card, recent wins, and
  // coach's-focus cards all decorate names with the stroke suffix for
  // shared skills like Tempo.
  const catalogIndex = buildCatalogIndex(categories);
  const skillsBySlug = new Map<string, ParentSkillProgress>();
  for (const skill of progress.skills) skillsBySlug.set(skill.slug, skill);

  // Session dates union — scoreHistory ships one entry per evaluation
  // session already, so the count there matches "evaluations this season".
  const sessionDates = scoreHistory.points.map((point) => point.sessionDate);
  const summaryCard = buildSummaryCard(displaySkills, sessionDates, swimmer.firstName);
  const recentWins = buildRecentWins(displaySkills, catalogIndex);

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
        <div className="mx-auto max-w-content flex flex-col gap-8">
          <div className="flex flex-col gap-3">
            <a href="/dashboard" className="text-sm underline text-link">
              ← Dashboard
            </a>
            <h1
              className="text-heading text-text font-heading"
              style={{ fontSize: "clamp(1.75rem, 1.2rem + 2.5vw, 2.5rem)", fontVariationSettings: "\"SOFT\" 100, \"WONK\" 0" }}
            >
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

          {hasAnyData && (
            <>
              {/* Top row: summary card + recent wins side-by-side on
                  tablet and desktop, stacked on phone. */}
              <div className="grid gap-4 tablet:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start">
                <SummaryCard data={summaryCard} firstName={swimmer.firstName} />
                <RecentWins wins={recentWins} swimmerFirstName={swimmer.firstName} />
              </div>

              <CoachFocus
                latestPriority={progress.latestCoachingPriority}
                workingOnNext={progress.coachingPriorities}
                swimmerFirstName={swimmer.firstName}
                skillsBySlug={skillsBySlug}
                catalogIndex={catalogIndex}
              />

              {categorySnapshot.length > 0 && (
                <section
                  className="flex flex-col gap-3"
                  aria-labelledby="parent-snapshot-heading"
                  data-testid="parent-progress-snapshot"
                >
                  <h2
                    id="parent-snapshot-heading"
                    className="text-lg font-heading text-text"
                    style={{ fontVariationSettings: "\"SOFT\" 100, \"WONK\" 0" }}
                  >
                    Snapshot
                  </h2>
                  {/* Cap the radar's render width at every breakpoint.
                      SVG text font-size scales with the viewBox when the
                      container grows unbounded; capping width here keeps
                      the labels close to body-text size on desktop. */}
                  <div
                    className="rounded-lg border p-4 mx-auto w-full max-w-[380px] tablet:max-w-[440px] desktop:max-w-[520px]"
                    style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-border)" }}
                  >
                    <CategoryRadar
                      categories={categorySnapshot}
                      {...(firstSnapshot.length > 0 && { firstEvaluation: firstSnapshot })}
                    />
                  </div>
                </section>
              )}

              <section
                className="flex flex-col gap-3"
                aria-labelledby="parent-skills-heading"
                data-testid="parent-progress-skills"
              >
                <h2
                  id="parent-skills-heading"
                  className="text-lg font-heading text-text"
                  style={{ fontVariationSettings: "\"SOFT\" 100, \"WONK\" 0" }}
                >
                  Skills
                </h2>
                <ParentStrokeGroupsPanel
                  skills={displaySkills}
                  startProgress={progress.startProgress}
                  categories={categories}
                  nowIso={nowIso}
                  rollups={latestScreenGroupRollups}
                />
              </section>

              {progress.startProgress.length > 0 && (
                <section
                  className="flex flex-col gap-3"
                  aria-labelledby="parent-starts-heading"
                  data-testid="parent-progress-starts"
                >
                  <h2
                    id="parent-starts-heading"
                    className="text-lg font-heading text-text"
                    style={{ fontVariationSettings: "\"SOFT\" 100, \"WONK\" 0" }}
                  >
                    Starts
                  </h2>
                  <StartsSection
                    startProgress={progress.startProgress}
                    swimmerSkills={progress.skills.map((skill) => ({
                      slug: skill.slug,
                      // The shared StartsSection reads only slug + history; the
                      // parent variant's `history` type already strips faultTags
                      // vs. the coach variant, so pass-through is safe.
                      history: skill.history,
                    }))}
                    showSessionGrid={false}
                    showStillToGrade={false}
                  />
                </section>
              )}
              {/* Golf score section deferred: parent progress response
                  doesn't ship golf data yet, and the /parent/golf-score
                  endpoint is coach-only. Tracked for the next pass. */}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
