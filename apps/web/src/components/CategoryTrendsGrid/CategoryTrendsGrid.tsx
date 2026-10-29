"use client";

import { formatSessionDate } from "@/lib/progressCharts";

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
      {categories.map((category) => (
        <li
          key={category.name}
          className="flex flex-col gap-1 p-3 rounded-[var(--radius-card)]"
          style={{ backgroundColor: "var(--color-surface-soft)" }}
        >
          <p className="text-xs font-semibold text-text truncate">{category.name}</p>
          <MiniLine points={category.points} />
        </li>
      ))}
    </ul>
  );
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

  const xFor = (index: number): number => padLeft + (index / (points.length - 1)) * plotWidth;
  const yFor = (value: number): number => padTop + plotHeight - ((value - 1) / 4) * plotHeight;

  const segments: Array<Array<{ x: number; y: number; index: number }>> = [];
  let currentSegment: Array<{ x: number; y: number; index: number }> = [];
  points.forEach((pointItem, index) => {
    if (pointItem.value === null) {
      if (currentSegment.length > 0) {
        segments.push(currentSegment);
        currentSegment = [];
      }
    } else {
      currentSegment.push({ x: xFor(index), y: yFor(pointItem.value), index });
    }
  });
  if (currentSegment.length > 0) segments.push(currentSegment);

  const latestNonNull = nonNullValues[nonNullValues.length - 1]!;

  return (
    <div className="flex items-center justify-between gap-2">
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-hidden="true"
        className="shrink-0"
      >
        {segments.map((segment, segmentIndex) => (
          <polyline
            key={segmentIndex}
            points={segment.map((pointCoord) => `${pointCoord.x},${pointCoord.y}`).join(" ")}
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
                cx={xFor(index)}
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
      <span
        className="text-sm font-heading tabular-nums shrink-0"
        style={{ color: "var(--color-accent)" }}
      >
        {latestNonNull.toFixed(1)}
      </span>
    </div>
  );
}
