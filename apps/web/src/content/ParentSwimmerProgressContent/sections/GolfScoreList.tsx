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

// Parent-side golf-score renderer. Switches between two visual forms
// via viewport CSS:
//
//   - Desktop (≥1248px): compact one-row-per-stroke list used in the
//     desktop side column. Each row is stroke / latest score / change
//     since the first score.
//   - Phone / tablet: 2-up or 3-up card grid.
//
// Category switch only appears when more than one category has data.
// Returns null when the response has no trends, so the layout section
// can live-wrapper the list and the whole section hides naturally.
export default function GolfScoreList({ trends }: GolfScoreListProps) {
  // Which categories actually have at least one point across all
  // trends. The tab strip only renders when there's more than one.
  const categoriesPresent = useMemo(() => collectCategoriesPresent(trends), [trends]);
  const [activeCategory, setActiveCategory] = useState<GolfScoreCategory | null>(
    categoriesPresent[0] ?? null,
  );

  if (trends.length === 0 || categoriesPresent.length === 0) return null;

  // If the selection is stale (data changed and the selected category
  // is gone), fall back to the first available one.
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
      {/* Card grid: visible on phone and tablet; hidden on desktop. */}
      <div
        className="grid grid-cols-1 gap-3 tablet:grid-cols-2 desktop:hidden"
        data-testid="parent-golf-score-cards"
      >
        {visibleTrends.map(({ trend, category }) => (
          <CardRow key={trend.skillSlug} trend={trend} category={category} />
        ))}
      </div>
      {/* Compact list: hidden on phone/tablet; visible on desktop. */}
      <ul
        className="hidden desktop:flex flex-col gap-2 text-sm"
        data-testid="parent-golf-score-compact-list"
      >
        {visibleTrends.map(({ trend, category }, index) => (
          <li
            key={trend.skillSlug}
            className="flex items-baseline justify-between gap-2"
            style={index > 0 ? { borderTop: "1px solid var(--color-border)", paddingTop: "0.5rem" } : undefined}
          >
            <span className="text-text truncate">{trend.skillName}</span>
            <span className="tabular-nums font-semibold text-text">{formatScore(latestScore(category.points))}</span>
            <span className="text-xs text-text-secondary">{changeLabel(category.points)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Rendering helpers ────────────────────────────────────────────────────

function CardRow({ trend, category }: { trend: ParentGolfScoreTrend; category: ParentGolfScoreCategoryTrend }) {
  const latest = latestScore(category.points);
  return (
    <div
      className="rounded-lg border p-4 flex flex-col gap-1"
      style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-border)" }}
    >
      <span className="text-xs font-semibold text-text">{trend.skillName}</span>
      <span className="font-heading text-2xl font-semibold text-text tabular-nums">{formatScore(latest)}</span>
      <span className="text-xs text-text-secondary">{changeLabel(category.points)}</span>
    </div>
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
      if (categoryTrend.points.length > 0) present.add(categoryTrend.category);
    }
  }
  // Preserve a stable visual order rather than the Set's insertion order.
  return CATEGORY_ORDER.filter((category) => present.has(category));
}
