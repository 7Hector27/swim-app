"use client";

import { useMemo, useState } from "react";
import type {
  GolfScoreCategory,
  ParentGolfScoreCategoryTrend,
  ParentGolfScoreTrend,
  ParentGolfScoreTrendPoint,
} from "@swim-app/shared";

interface GolfScoreListProps {
  trends: ReadonlyArray<ParentGolfScoreTrend>;
}

const CATEGORY_LABELS: Record<GolfScoreCategory, string> = {
  push_off_in_water: "Push-off",
  deck_dive: "Deck dive",
  block_dive: "Block dive",
};

const CATEGORY_ORDER: GolfScoreCategory[] = ["push_off_in_water", "deck_dive", "block_dive"];

// One card per stroke across a responsive grid. The parent page's Golf
// section only mounts when there's at least one scored trend, so empty
// states don't reach this component.
//
// The category switch only appears when more than one category has data.
export default function GolfScoreList({ trends }: GolfScoreListProps) {
  const categoriesPresent = useMemo(() => collectCategoriesPresent(trends), [trends]);
  const [activeCategory, setActiveCategory] = useState<GolfScoreCategory | null>(
    categoriesPresent[0] ?? null,
  );

  if (trends.length === 0 || categoriesPresent.length === 0) return null;

  const safeActive = categoriesPresent.includes(activeCategory as GolfScoreCategory)
    ? (activeCategory as GolfScoreCategory)
    : (categoriesPresent[0] as GolfScoreCategory);

  const visibleTrends = trends
    .map((trend) => {
      const category = trend.byCategory.find((entry) => entry.category === safeActive);
      if (!category || category.points.length === 0) return null;
      return { trend, category };
    })
    .filter((entry): entry is { trend: ParentGolfScoreTrend; category: ParentGolfScoreCategoryTrend } => entry !== null);

  if (visibleTrends.length === 0) return null;

  return (
    <div className="flex flex-col gap-3" data-testid="parent-golf-score-list">
      {categoriesPresent.length > 1 && (
        <div
          role="radiogroup"
          aria-label="Golf score category"
          className="flex flex-wrap gap-2"
          data-testid="parent-golf-category-switch"
        >
          {categoriesPresent.map((category) => {
            const selected = category === safeActive;
            return (
              <button
                key={category}
                type="button"
                role="radio"
                aria-checked={selected}
                className="text-xs font-semibold px-3 py-1 rounded-full border min-h-[32px]"
                style={{
                  backgroundColor: selected ? "var(--color-accent)" : "var(--color-background)",
                  color: selected ? "var(--color-on-accent)" : "var(--color-text)",
                  borderColor: selected ? "var(--color-accent)" : "var(--color-border)",
                }}
                onClick={() => setActiveCategory(category)}
              >
                {CATEGORY_LABELS[category]}
              </button>
            );
          })}
        </div>
      )}
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}
        data-testid="parent-golf-score-cards"
      >
        {visibleTrends.map(({ trend, category }) => (
          <CardRow key={trend.skillSlug} trend={trend} category={category} />
        ))}
      </div>
    </div>
  );
}

// ── Rendering helpers ────────────────────────────────────────────────────

function CardRow({ trend, category }: { trend: ParentGolfScoreTrend; category: ParentGolfScoreCategoryTrend }) {
  const latest = latestScore(category.points);
  return (
    <div
      className="rounded-lg border p-4 flex flex-col gap-2"
      style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-border)" }}
      data-testid="parent-golf-score-card"
      data-slug={trend.skillSlug}
    >
      <span className="text-xs font-semibold text-text">{trend.skillName}</span>
      <span className="font-heading text-2xl font-semibold text-text tabular-nums">{formatScore(latest)}</span>
      <Sparkline
        skillName={trend.skillName}
        points={category.points}
        ageBands={category.ageBands}
      />
      <span className="text-xs text-text-secondary">{changeLabel(category.points)}</span>
    </div>
  );
}

// Per-card sparkline matching docs/design/parent-progress-page-mock.html:
// a soft age-group band spanning p25..p75, a polyline through the scored
// points, and a filled dot at the newest point. A single-rating card
// draws only the dot (plus the band, if available). Hidden entirely
// when the category has no scorable points — a partial measurement
// shouldn't surface the section at all upstream.
const SPARK_VIEW_WIDTH = 150;
const SPARK_VIEW_HEIGHT = 54;
const SPARK_PAD_X = 6;
const SPARK_Y_TOP = 6;
const SPARK_Y_BOTTOM = 48;

function Sparkline({
  skillName,
  points,
  ageBands,
}: {
  skillName: string;
  points: ReadonlyArray<ParentGolfScoreTrendPoint>;
  ageBands: ParentGolfScoreCategoryTrend["ageBands"];
}) {
  const scoredPoints = points.filter(
    (point) => point.timeSeconds !== null && point.strokeCountValue !== null,
  );
  const totals = scoredPoints.map((point) => (point.timeSeconds ?? 0) + (point.strokeCountValue ?? 0));
  if (totals.length === 0) return null;

  // Value range covers both the swimmer's points and the age band so the
  // band and the line stay in the same visual space. Pad by 5% so markers
  // sit inside the plot rather than on the edges; when min === max (a
  // single flat series with no band), fall back to a 1-unit span.
  const bandMin = ageBands !== null ? ageBands.p25 : null;
  const bandMax = ageBands !== null ? ageBands.p75 : null;
  const candidates: number[] = [...totals];
  if (bandMin !== null) candidates.push(bandMin);
  if (bandMax !== null) candidates.push(bandMax);
  let rangeMin = Math.min(...candidates);
  let rangeMax = Math.max(...candidates);
  if (rangeMax === rangeMin) {
    rangeMin -= 0.5;
    rangeMax += 0.5;
  }
  const pad = (rangeMax - rangeMin) * 0.05;
  rangeMin -= pad;
  rangeMax += pad;

  // Higher value → higher in SVG (smaller y). Lower-is-better plots
  // physically lower on the chart, matching the mock's "line falling =
  // score improving" read.
  function yFor(value: number): number {
    const t = (value - rangeMin) / (rangeMax - rangeMin);
    return SPARK_Y_BOTTOM - t * (SPARK_Y_BOTTOM - SPARK_Y_TOP);
  }

  function xFor(index: number): number {
    if (totals.length <= 1) return SPARK_VIEW_WIDTH - SPARK_PAD_X;
    return SPARK_PAD_X + (index / (totals.length - 1)) * (SPARK_VIEW_WIDTH - 2 * SPARK_PAD_X);
  }

  const polylinePoints = totals.map((value, index) => `${xFor(index)},${yFor(value)}`).join(" ");
  const latestIndex = totals.length - 1;
  const latestX = xFor(latestIndex);
  const latestY = yFor(totals[latestIndex]!);

  const bandY = bandMax !== null ? yFor(bandMax) : null;
  const bandHeight = bandMin !== null && bandMax !== null ? yFor(bandMin) - yFor(bandMax) : null;

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${SPARK_VIEW_WIDTH} ${SPARK_VIEW_HEIGHT}`}
      role="img"
      aria-label={`${skillName} golf score trend`}
      className="block"
      data-testid="parent-golf-score-sparkline"
      data-point-count={totals.length}
    >
      {bandY !== null && bandHeight !== null && (
        <rect
          x={0}
          y={bandY}
          width={SPARK_VIEW_WIDTH}
          height={bandHeight}
          fill="color-mix(in oklab, var(--color-accent) 15%, var(--color-background))"
          data-testid="parent-golf-score-band"
        />
      )}
      {totals.length >= 2 && (
        <polyline
          points={polylinePoints}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          data-testid="parent-golf-score-line"
        />
      )}
      <circle
        cx={latestX}
        cy={latestY}
        r={4}
        fill="var(--color-accent)"
        data-testid="parent-golf-score-latest-dot"
      />
    </svg>
  );
}

function latestScore(points: ReadonlyArray<ParentGolfScoreTrendPoint>): number | null {
  // Points are oldest-first (asc(ratedAt) on the server). Walk back from
  // the end to pick the newest point with both time + strokes present.
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const point = points[index];
    if (!point) continue;
    if (point.timeSeconds !== null && point.strokeCountValue !== null) {
      return point.timeSeconds + point.strokeCountValue;
    }
  }
  return null;
}

function firstScore(points: ReadonlyArray<ParentGolfScoreTrendPoint>): number | null {
  for (const point of points) {
    if (point.timeSeconds !== null && point.strokeCountValue !== null) {
      return point.timeSeconds + point.strokeCountValue;
    }
  }
  return null;
}

function firstMonth(points: ReadonlyArray<ParentGolfScoreTrendPoint>): string | null {
  const firstDate = points[0]?.sessionDate ?? null;
  if (!firstDate) return null;
  const [year, month, day] = firstDate.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) return null;
  return new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, day)),
  );
}

function formatScore(value: number | null): string {
  if (value === null) return "—";
  return value.toFixed(1);
}

function changeLabel(points: ReadonlyArray<ParentGolfScoreTrendPoint>): string {
  const latest = latestScore(points);
  const first = firstScore(points);
  if (latest === null) return "No score yet";
  if (first === null || points.length === 1) return "First score";
  const delta = Math.round((latest - first) * 10) / 10;
  const month = firstMonth(points);
  if (delta === 0) return `Steady since ${month ?? "the first lesson"}`;
  const direction = delta < 0 ? "Down" : "Up";
  return `${direction} ${Math.abs(delta).toFixed(1)}${month ? ` since ${month}` : ""}`;
}

function collectCategoriesPresent(
  trends: ReadonlyArray<ParentGolfScoreTrend>,
): GolfScoreCategory[] {
  const present = new Set<GolfScoreCategory>();
  for (const trend of trends) {
    for (const categoryTrend of trend.byCategory) {
      // "Present" means at least one scorable point — both time and strokes
      // recorded. A partially-captured point shouldn't surface the category.
      if (
        categoryTrend.points.some(
          (point) => point.timeSeconds !== null && point.strokeCountValue !== null,
        )
      ) {
        present.add(categoryTrend.category);
      }
    }
  }
  return CATEGORY_ORDER.filter((category) => present.has(category));
}
