"use client";

import { formatSessionDate } from "@/lib/progressCharts";
import { realDateXFor, stepLinePath } from "@/lib/stepChart";

interface CategoryTrendPoint {
  sessionDate: string;
  value: number | null;
}

interface CategoryTrendsGridProps {
  categories: Array<{
    name: string;
    points: CategoryTrendPoint[];
  }>;
}

export default function CategoryTrendsGrid({ categories }: CategoryTrendsGridProps) {
  return (
    <ul className="grid grid-cols-2 tablet:grid-cols-2 gap-3">
      {categories.map((category) => {
        // Latest non-null value pulled up to the header so it renders beside
        // the name instead of competing with the SVG for horizontal space in
        // narrow right-column cards (it was clipping off the right edge).
        const latest = latestValue(category.points);
        return (
          <li
            key={category.name}
            className="flex flex-col gap-1 p-3 rounded-[var(--radius-card)] min-w-0 overflow-hidden"
            style={{ backgroundColor: "var(--color-surface-soft)" }}
          >
            <div className="flex items-baseline justify-between gap-2 min-w-0">
              <p className="text-xs font-semibold text-text truncate min-w-0">{category.name}</p>
              {latest !== null && (
                <span
                  className="text-sm font-heading tabular-nums shrink-0"
                  style={{ color: "var(--color-accent)" }}
                >
                  {latest.toFixed(1)}
                </span>
              )}
            </div>
            <MiniLine points={category.points} />
          </li>
        );
      })}
    </ul>
  );
}

function latestValue(points: CategoryTrendPoint[]): number | null {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const value = points[index]?.value;
    if (value !== null && value !== undefined) return value;
  }
  return null;
}

function MiniLine({ points }: { points: CategoryTrendPoint[] }) {
  const width = 160;
  const height = 48;
  const padLeft = 2;
  const padRight = 2;
  const padTop = 6;
  const padBottom = 6;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;

  const nonNullValues = points
    .map((pointItem) => pointItem.value)
    .filter((value): value is number => value !== null);

  if (nonNullValues.length < 2) {
    return (
      <p className="text-xs text-text-secondary italic h-12 flex items-center">
        Not enough data yet.
      </p>
    );
  }

  const xForDate = realDateXFor(points.map((pointItem) => pointItem.sessionDate), padLeft, plotWidth);
  const yFor = (value: number): number => padTop + plotHeight - ((value - 1) / 4) * plotHeight;

  // Build step-line segments keyed off real dates. Null-valued points break
  // the current segment the same way they did on the index-based version so
  // a measurement gap renders as a break, not a stale carried value.
  const segments: Array<Array<{ x: number; y: number; index: number }>> = [];
  let currentSegment: Array<{ x: number; y: number; index: number }> = [];
  points.forEach((pointItem, index) => {
    if (pointItem.value === null) {
      if (currentSegment.length > 0) {
        segments.push(currentSegment);
        currentSegment = [];
      }
    } else {
      currentSegment.push({ x: xForDate(pointItem.sessionDate), y: yFor(pointItem.value), index });
    }
  });
  if (currentSegment.length > 0) segments.push(currentSegment);

  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-hidden="true"
      className="block w-full"
    >
      {segments.map((segment, segmentIndex) => (
        <path
          key={segmentIndex}
          d={stepLinePath(segment)}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {points.map((pointItem, index) => {
        if (pointItem.value === null) return null;
        return (
          <g key={`${pointItem.sessionDate}-${index}`}>
            <title>{`${formatSessionDate(pointItem.sessionDate)} · ${pointItem.value.toFixed(1)}`}</title>
            <circle
              cx={xForDate(pointItem.sessionDate)}
              cy={yFor(pointItem.value)}
              r={2.5}
              fill="var(--color-surface-soft)"
              stroke="var(--color-accent)"
              strokeWidth={1.25}
            />
          </g>
        );
      })}
    </svg>
  );
}
