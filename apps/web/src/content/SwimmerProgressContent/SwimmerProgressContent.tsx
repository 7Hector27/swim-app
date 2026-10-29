import type {
  CategoriesResponse,
  CoachSwimmerDetail,
  GolfScoreTrendsResponse,
  ScoreHistoryResponse,
  SwimmerProgressResponse,
} from "@swim-app/shared";
import HeroTrendChart from "@/components/HeroTrendChart";
import CategoryTrendsGrid from "@/components/CategoryTrendsGrid";
import StartProgression from "@/components/StartProgression";
import {
  categoryTrendSeries,
  headPositionSeries,
  latestCategorySnapshot,
  startSeries,
} from "@/lib/progressCharts";
import CategoryRadar from "./charts/CategoryRadar";
import GolfScoreCard from "./charts/GolfScoreCard";
import FaultTagBars from "./charts/FaultTagBars";
import SessionCadence from "./charts/SessionCadence";
import SkillRow from "./SkillRow";
import WhatToWorkOn from "./WhatToWorkOn";
import {
  faultTagFrequency,
  headPositionTrailingDelta,
  sessionCadence,
} from "./helpers";

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
}: SwimmerProgressContentProps) {
  const now = nowIso !== undefined ? new Date(nowIso) : new Date();
  const headPosPoints = headPositionSeries(scoreHistory);
  const categorySnapshot = latestCategorySnapshot(scoreHistory);
  const categoryTrends = categoryTrendSeries(scoreHistory);
  const starts = startSeries(scoreHistory);
  const trailing = headPositionTrailingDelta(progress, scoreHistory);
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

  const skillsByCategory = groupSkillsByCategory(progress, categories);

  return (
    <div className="flex flex-col flex-1">
      <main className="flex-1 px-page py-6 tablet:py-10">
        <div className="mx-auto max-w-content flex flex-col gap-6 tablet:gap-10">
          <PageHeader swimmer={swimmer} />

          <div className="grid gap-6 tablet:gap-10 tablet:grid-cols-[7fr_5fr] items-start">
            <div className="flex flex-col gap-6 min-w-0">
              <WhatToWorkOn priorities={progress.coachingPriorities} swimmerId={swimmer.id} />

              <section
                className="p-4 tablet:p-6 rounded-[var(--radius-card)] border"
                style={{ borderColor: "var(--color-border)" }}
              >
                <HeroTrendChart
                  title="Head position overall"
                  current={progress.headPositionOverall}
                  points={headPosPoints}
                  editContext={editContext}
                  {...(trailing !== undefined && { trailingDeltaLabel: trailing })}
                />
                {isOneEvaluation && (
                  <p className="mt-3 text-xs text-text-secondary italic">
                    Trends unlock after the second rating. Rate again next session.
                  </p>
                )}
              </section>

              <section className="flex flex-col gap-3">
                <h2 className="text-lg font-heading text-text" style={{ fontVariationSettings: "\"SOFT\" 100, \"WONK\" 0" }}>
                  Category snapshot
                </h2>
                <div className="max-w-[360px] tablet:max-w-[480px] desktop:max-w-[560px] mx-auto w-full">
                  <CategoryRadar categories={categorySnapshot} />
                </div>
                {!isOneEvaluation && (
                  <details className="group mt-1">
                    <summary
                      className="text-sm font-semibold cursor-pointer list-none flex items-center gap-2 py-2 min-h-[44px]"
                      style={{ color: "var(--color-link)" }}
                    >
                      <span aria-hidden="true" className="transition-transform duration-200 group-open:rotate-90">
                        ›
                      </span>
                      <span>Open category trends</span>
                    </summary>
                    <div className="pt-2">
                      <CategoryTrendsGrid categories={categoryTrends} />
                    </div>
                  </details>
                )}
              </section>

              <section className="flex flex-col gap-3">
                <h2 className="text-lg font-heading text-text" style={{ fontVariationSettings: "\"SOFT\" 100, \"WONK\" 0" }}>
                  Starts
                </h2>
                {starts.length === 0 ? (
                  <p className="text-sm text-text-secondary">No start ratings yet.</p>
                ) : (
                  <div className="flex flex-col gap-5">
                    {starts.map((start) => (
                      <StartProgression key={start.slug} name={start.name} points={start.points} editContext={editContext} />
                    ))}
                  </div>
                )}
              </section>

              {golfScore.trends.length > 0 && (
                <section className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1">
                    <h2 className="text-lg font-heading text-text" style={{ fontVariationSettings: "\"SOFT\" 100, \"WONK\" 0" }}>
                      Golf score
                    </h2>
                    <p className="text-xs text-text-secondary">Lower is better. Band shows age-group 25th to 75th percentile.</p>
                  </div>
                  {golfScore.trends.map((trend) => (
                    <GolfScoreCard key={trend.skillSlug} trend={trend} editContext={editContext} />
                  ))}
                </section>
              )}

              {faultTags.length > 0 && (
                <section className="flex flex-col gap-3">
                  <h2 className="text-lg font-heading text-text" style={{ fontVariationSettings: "\"SOFT\" 100, \"WONK\" 0" }}>
                    Fault tags{" "}
                    <span className="text-xs font-body text-text-secondary">coach only</span>
                  </h2>
                  <FaultTagBars tags={faultTags} />
                </section>
              )}

              <section className="flex flex-col gap-3">
                <h2 className="text-lg font-heading text-text" style={{ fontVariationSettings: "\"SOFT\" 100, \"WONK\" 0" }}>
                  Session cadence
                </h2>
                <SessionCadence weeks={cadence} />
              </section>
            </div>

            <div className="flex flex-col gap-4 min-w-0">
              <h2 className="text-lg font-heading text-text" style={{ fontVariationSettings: "\"SOFT\" 100, \"WONK\" 0" }}>
                Skills
              </h2>
              {skillsByCategory.map((bucket) => (
                <details key={bucket.id} className="group" open>
                  <summary
                    className="text-sm font-semibold cursor-pointer list-none flex items-center gap-2 py-2 min-h-[44px] border-b"
                    style={{ color: "var(--color-text)", borderColor: "var(--color-border)" }}
                  >
                    <span aria-hidden="true" className="transition-transform duration-200 group-open:rotate-90">
                      ›
                    </span>
                    <span>{bucket.name}</span>
                    <span className="text-xs text-text-secondary ml-auto">
                      {bucket.skills.length} rated
                    </span>
                  </summary>
                  <ul className="flex flex-col">
                    {bucket.skills.map((skill) => (
                      <SkillRow
                        key={skill.skillId}
                        skill={skill}
                        swimmerId={swimmer.id}
                        nowIso={now.toISOString()}
                        editContext={editContext}
                      />
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          </div>
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
        <h1
          className="text-3xl tablet:text-5xl font-heading"
          style={{ color: "var(--color-heading)", fontVariationSettings: "\"SOFT\" 100, \"WONK\" 0" }}
        >
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

function groupSkillsByCategory(
  progress: SwimmerProgressResponse,
  categories: CategoriesResponse,
): Array<{ id: string; name: string; skills: SwimmerProgressResponse["skills"] }> {
  const startParentSlugs = new Set(progress.startProgress.map((start) => start.slug));
  const startComponentSlugs = new Set(
    progress.startProgress.flatMap((start) => start.components.map((component) => component.slug)),
  );

  const buckets = new Map<string, { name: string; skills: SwimmerProgressResponse["skills"] }>();
  for (const skill of progress.skills) {
    if (startParentSlugs.has(skill.slug)) continue;
    if (startComponentSlugs.has(skill.slug)) continue;
    const existing = buckets.get(skill.categoryId);
    if (existing) {
      existing.skills.push(skill);
    } else {
      buckets.set(skill.categoryId, { name: skill.categoryName, skills: [skill] });
    }
  }

  const ordered: Array<{ id: string; name: string; skills: SwimmerProgressResponse["skills"] }> = [];
  for (const category of categories) {
    const bucket = buckets.get(category.id);
    if (bucket) ordered.push({ id: category.id, ...bucket });
  }
  for (const [id, bucket] of buckets.entries()) {
    if (ordered.find((entry) => entry.id === id)) continue;
    ordered.push({ id, ...bucket });
  }
  return ordered;
}
