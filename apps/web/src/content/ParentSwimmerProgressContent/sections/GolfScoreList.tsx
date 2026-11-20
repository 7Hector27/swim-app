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
      className="rounded-lg border p-4 flex flex-col gap-1"
      style={{ backgroundColor: "var(--color-background)", borderColor: "var(--color-border)" }}
      data-testid="parent-golf-score-card"
    >
      <span className="text-xs font-semibold text-text">{trend.skillName}</span>
      <div className="flex items-baseline gap-2">
        <span className="font-heading text-2xl font-semibold text-text tabular-nums">{formatScore(latest)}</span>
        <span className="text-xs text-text-secondary">{changeLabel(category.points)}</span>
      </div>
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
