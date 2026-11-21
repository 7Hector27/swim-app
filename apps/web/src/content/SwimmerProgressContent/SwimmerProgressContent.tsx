import type {
  CategoriesResponse,
  CoachSwimmerDetail,
  GolfScoreTrendsResponse,
  ScoreHistoryResponse,
  SwimmerProgressResponse,
} from "@swim-app/shared";
import CategoryTrendsGrid from "@/components/CategoryTrendsGrid";
import GroupStandings, { buildLanes } from "@/components/GroupStandings";
import InlineError from "@/components/InlineError";
import StartsSection from "@/components/StartsSection";
import {
  firstScreenGroupSnapshot,
  latestScreenGroupSnapshot,
  screenGroupTrendSeries,
} from "@/lib/progressCharts";
import CategoryRadar from "./charts/CategoryRadar";
import GolfScoreCard from "./charts/GolfScoreCard";
import FaultTagBars from "./charts/FaultTagBars";
import SessionCadence from "./charts/SessionCadence";
import StrokeGroupsPanel from "./StrokeGroupsPanel";
import WhatToWorkOn from "./WhatToWorkOn";
import {
  faultTagFrequency,
  sessionCadence,
} from "./helpers";

// Per-section failure flags for the secondary fetches on the progress page.
// `progress` is primary (the page throws if it fails), so it's not listed.
// All optional — defaults to false, keeping existing tests green.
export interface SwimmerProgressSectionFailures {
  categories?: boolean;
  scoreHistory?: boolean;
  golfScore?: boolean;
}

interface SwimmerProgressContentProps {
  swimmer: CoachSwimmerDetail;
  progress: SwimmerProgressResponse;
  categories: CategoriesResponse;
  scoreHistory: ScoreHistoryResponse;
  golfScore: GolfScoreTrendsResponse;
  // ISO string captured on the server at request time. Pinning the "now"
  // moment server-side keeps the "Rated N days ago" text identical during
  // SSR and client hydration — without this, the server and the client would
  // each call `new Date()` and could land on different day counts near
  // midnight. Tests can override. Falls back to `new Date().toISOString()`
  // in test environments where callers don't pass it.
  nowIso?: string;
  sectionFailures?: SwimmerProgressSectionFailures;
}

// Option C narrative stack as the real coach progress page. Phone: single
// column in the order from the dev preview. Tablet+: full-width container
// with a 7/5 two-column split — hero, what to work on next, and the charts
// stack on the left; the per-skill list runs on the right so wide screens
// don't waste space.
export default function SwimmerProgressContent({
  swimmer,
  progress,
  categories,
  scoreHistory,
  golfScore,
  nowIso,
  sectionFailures = {},
}: SwimmerProgressContentProps) {
  const now = nowIso !== undefined ? new Date(nowIso) : new Date();
  // Pass 3: radar + trend grid now bucket by evaluate-screen groups
  // instead of catalog categories.
  const categorySnapshot = latestScreenGroupSnapshot(scoreHistory);
  const firstSnapshot = firstScreenGroupSnapshot(scoreHistory);
  const lanes = buildLanes(firstSnapshot, categorySnapshot);
  const categoryTrends = screenGroupTrendSeries(scoreHistory);
  const faultTags = faultTagFrequency(progress);
  const cadence = sessionCadence(progress, now);

  // ADR 032: deep-link back to this page (with a URL-safe returnTo) so
  // save-changes brings the coach straight back to progress. We pass
  // serializable context — not a function — because this component is a
  // server component and the children are client components; Next.js refuses
  // function props across that boundary. The children build the href using
  // evaluationEditHref().
  const editContext = {
    swimmerId: swimmer.id,
    returnTo: `/coach/swimmers/${swimmer.id}/progress`,
  };

  const hasAnyData =
    progress.skills.length > 0 ||
    progress.startProgress.some(
      (start) =>
        start.grade.status !== "in_progress" ||
        start.components.some((component) => component.current !== null),
    );
  const totalRatings = progress.skills.reduce((sum, skill) => sum + skill.history.length, 0);
  const isOneEvaluation = scoreHistory.points.length === 1 || (hasAnyData && totalRatings <= 1);

  if (!hasAnyData) {
    return <EmptyState swimmer={swimmer} />;
  }

  // Pass 3: nine evaluate-screen groups instead of catalog categories.
  // Start components (track-start-reaction, …) aren't in SCREEN_SECTIONS,
  // so they never land as rows in a group — but we drop them from the
  // input list anyway to keep the payload the panel resolves against
  // tight. Start parent slugs (track-start, relay-start, back-start) are
  // kept here: the panel synthesizes composite rows from
  // progress.startProgress so the Starts section inside the Starts-and-
  // turns group lists them even though they aren't in progress.skills.
  const startComponentSlugs = new Set(
    progress.startProgress.flatMap((start) => start.components.map((component) => component.slug)),
  );
  const groupableSkills = progress.skills.filter(
    (skill) => !startComponentSlugs.has(skill.slug),
  );
  // Latest session's rollups drive the switcher badges + the header count.
  const latestScreenGroupRollups =
    scoreHistory.points[scoreHistory.points.length - 1]?.screenGroupRollups ?? [];

  const failedSections: string[] = [];
  if (sectionFailures.categories) failedSections.push("skill categories");
  if (sectionFailures.scoreHistory) failedSections.push("score history");
  if (sectionFailures.golfScore) failedSections.push("golf score");

  // GroupStandings itself renders null when lanes are empty, but the
  // whole second column should disappear too so the row doesn't leave a
  // dangling heading. The Snapshot column stays mounted regardless —
  // when there's no radar data, CategoryRadar renders null and the
  // heading alone shows, matching the older coach layout.
  const standingsVisible = lanes.length > 0;

  // The coach page always shows the Golf score heading + caption, and
  // falls through to "No golf scores yet." when there's nothing to
  // plot. A trend counts as data only when at least one point carries
  // both time + strokes — a trend that exists but only holds partial
  // measurements shouldn't be mistaken for scored data.
  const golfHasScoredPoints = golfScore.trends.some((trend) =>
    trend.byCategory.some((cat) =>
      cat.points.some((point) => point.timeSeconds !== null && point.strokeCountValue !== null),
    ),
  );

  return (
    <div className="flex flex-col flex-1">
      <main className="flex-1 px-page py-6 tablet:py-10">
        <div className="@container/progress mx-auto max-w-content flex flex-col gap-6 tablet:gap-10">
          <PageHeader swimmer={swimmer} />

          {failedSections.length > 0 && (
            <InlineError
              message={`Couldn't load ${failedSections.join(", ")}. The rest of the page is current.`}
              reloadOnRetry
            />
          )}

          <WhatToWorkOn priorities={progress.coachingPriorities} swimmerId={swimmer.id} />

          {/* Snapshot (radar) + Group standings row. Mirrors the parent
              page: two columns only when the content container is wide
              enough for each column to hit ~420px plus the 24px gap
              (2×420 + 24 = 864). Below that, the row stacks with
              Snapshot above so GroupStandings sits in its own full-
              width 4-col arrangement. */}
          <div
            className="grid grid-cols-1 @min-[864px]/progress:grid-cols-2 gap-6 items-start"
            data-testid="coach-progress-group-row"
          >
            <section
              className="flex flex-col gap-3 min-w-0"
              aria-labelledby="coach-snapshot-heading"
              data-testid="coach-progress-snapshot"
            >
              <h2 id="coach-snapshot-heading" className="text-lg font-heading text-text">
                Snapshot
              </h2>
              <CategoryRadar categories={categorySnapshot} />
              {!isOneEvaluation && (
                <details className="group mt-1">
                  <summary
                    className="text-sm font-semibold cursor-pointer list-none flex items-center gap-2 py-2 min-h-[44px]"
                    style={{ color: "var(--color-link)" }}
                  >
                    <span aria-hidden="true" className="transition-transform duration-200 group-open:rotate-90">
                      ›
                    </span>
                    <span>Open group trends</span>
                  </summary>
                  <div className="pt-2">
                    <CategoryTrendsGrid categories={categoryTrends} />
                  </div>
                </details>
              )}
            </section>
            {standingsVisible && (
              <section
                className="flex flex-col gap-3 min-w-0"
                aria-labelledby="coach-standings-heading"
                data-testid="coach-progress-group-standings"
              >
                <h2 id="coach-standings-heading" className="text-lg font-heading text-text">
                  {`Where ${swimmer.firstName} stands`}
                </h2>
                <GroupStandings lanes={lanes} />
              </section>
            )}
          </div>

          {/* DOM order (= phone order): Golf, Fault tags, Session
              cadence, Skills — unchanged from the prior layout. On
              tablet+ we flip to a single flex column with explicit
              `order` so Skills leads and Golf + Session cadence sit
              directly beneath it at the same full width:
                phone:   Golf → Fault tags → Session cadence → Skills
                tablet+: Skills → Golf → Fault tags → Session cadence
              Each section mounts exactly once; `tablet:order-N` moves
              it without a second copy. */}
          <div className="flex flex-col gap-6 tablet:gap-10" data-testid="coach-progress-main-sections">
            <section className="flex flex-col gap-3 min-w-0 tablet:order-2" data-testid="coach-progress-golf">
              <div className="flex flex-col gap-1">
                <h2 className="text-lg font-heading text-text">
                  Golf score
                </h2>
                <p className="text-xs text-text-secondary">Lower is better. Band shows age-group 25th to 75th percentile.</p>
              </div>
              {!golfHasScoredPoints ? (
                <p className="text-sm text-text-secondary" data-testid="coach-progress-golf-empty">No golf scores yet.</p>
              ) : (
                golfScore.trends.map((trend) => (
                  <GolfScoreCard key={trend.skillSlug} trend={trend} editContext={editContext} />
                ))
              )}
            </section>

            {faultTags.length > 0 && (
              <section className="flex flex-col gap-3 min-w-0 tablet:order-3" data-testid="coach-progress-faults">
                <h2 className="text-lg font-heading text-text">
                  Fault tags{" "}
                  <span className="text-xs font-body text-text-secondary">coach only</span>
                </h2>
                <FaultTagBars tags={faultTags} />
              </section>
            )}

            <section className="flex flex-col gap-3 min-w-0 tablet:order-4" data-testid="coach-progress-cadence">
              <h2 className="text-lg font-heading text-text">
                Session cadence
              </h2>
              <SessionCadence weeks={cadence} />
            </section>

            <section className="flex flex-col gap-4 min-w-0 tablet:order-1" data-testid="coach-progress-skills">
              <h2 className="text-lg font-heading text-text">
                Skills
              </h2>
              <StrokeGroupsPanel
                skills={groupableSkills}
                startProgress={progress.startProgress}
                categories={categories}
                swimmerId={swimmer.id}
                nowIso={now.toISOString()}
                editContext={editContext}
                rollups={latestScreenGroupRollups}
              />
            </section>
          </div>

          <section className="flex flex-col gap-3" data-testid="starts-section">
            <h2 className="text-lg font-heading text-text">
              Starts
            </h2>
            <StartsSection
              startProgress={progress.startProgress}
              swimmerSkills={progress.skills}
              swimmerFirstName={swimmer.firstName}
            />
          </section>
        </div>
      </main>
    </div>
  );
}

function PageHeader({ swimmer }: { swimmer: CoachSwimmerDetail }) {
  return (
    <header className="flex flex-col gap-3 tablet:flex-row tablet:items-center tablet:justify-between">
      <div className="flex flex-col gap-1">
        <a
          href={`/coach/swimmers/${swimmer.id}`}
          className="text-xs hover:underline"
          style={{ color: "var(--color-link)" }}
        >
          ‹ {swimmer.firstName} {swimmer.lastName}
        </a>
        <h1 className="text-3xl tablet:text-5xl font-heading text-heading">
          {swimmer.firstName}&apos;s Progress
        </h1>
      </div>
      <a
        href={`/coach/swimmers/${swimmer.id}/evaluate`}
        className="min-h-[52px] inline-flex items-center justify-center px-6 rounded-[var(--radius-button)] text-sm font-bold transition-transform duration-150 active:scale-[0.97]"
        style={{
          backgroundColor: "var(--color-button-primary-background)",
          color: "var(--color-button-primary-text)",
          transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)",
        }}
      >
        Evaluate
      </a>
    </header>
  );
}

function EmptyState({ swimmer }: { swimmer: CoachSwimmerDetail }) {
  return (
    <div className="flex flex-col flex-1">
      <main className="flex-1 px-page py-10">
        <div className="mx-auto max-w-content flex flex-col gap-6">
          <PageHeader swimmer={swimmer} />
          <div
            className="flex flex-col items-center gap-3 py-12 px-4 rounded-[var(--radius-card)] border text-center"
            style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-surface-soft)" }}
          >
            <div
              className="h-16 w-16 rounded-full flex items-center justify-center"
              style={{
                backgroundColor: "var(--color-background)",
                border: "1px dashed var(--color-placeholder-border)",
              }}
            >
              <span className="text-2xl font-heading" style={{ color: "var(--color-accent)" }}>+</span>
            </div>
            <p className="text-base font-semibold text-text">No evaluations recorded yet</p>
            <p className="text-sm text-text-secondary max-w-sm">
              Score the first session and the hero chart, radar, and starts will populate here.
            </p>
            <a
              href={`/coach/swimmers/${swimmer.id}/evaluate`}
              className="min-h-[52px] inline-flex items-center justify-center px-6 rounded-[var(--radius-button)] text-sm font-bold transition-transform duration-150 active:scale-[0.97] mt-2"
              style={{
                backgroundColor: "var(--color-button-primary-background)",
                color: "var(--color-button-primary-text)",
                transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)",
              }}
            >
              Start first evaluation
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}

// groupSkillsByCategory removed in Pass 3. The page now groups skills by
// evaluate-screen groups via buildScreenGroups in @/lib/screenGroups.
