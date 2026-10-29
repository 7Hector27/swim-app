"use client";

import { useId, useState } from "react";
import type { GolfScoreTrend } from "@swim-app/shared";
import { formatMonthDay, formatSessionDate } from "../helpers";

interface GolfScoreCardProps {
  trend: GolfScoreTrend;
}

const CATEGORY_LABELS: Record<string, string> = {
  push_off_in_water: "Push off in water",
  deck_dive: "Deck dive",
  block_dive: "Block dive",
};

const PHONE_MIN_HEIGHT_PX = 200;
const TABLET_MIN_HEIGHT_PX = 260;

export default function GolfScoreCard({ trend }: GolfScoreCardProps) {
  return (
    <div className="flex flex-col gap-4">
      {trend.byCategory.map((categoryTrend) => (
        <GolfCategory key={categoryTrend.category} skillName={trend.skillName} categoryTrend={categoryTrend} />
      ))}
    </div>
  );
}

function GolfCategory({
  skillName,
  categoryTrend,
}: {
  skillName: string;
  categoryTrend: GolfScoreTrend["byCategory"][number];
}) {
  const titleId = useId();
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const width = 480;
  const height = 240;
  const padLeft = 48;
  const padRight = 20;
  const padTop = 28;
  const padBottom = 36;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;

  const measurementValues = categoryTrend.points
    .map((pointItem) => Number(pointItem.measurementValue))
    .filter((value) => Number.isFinite(value));
  const bandValues = [categoryTrend.ageBands?.p25, categoryTrend.ageBands?.p50, categoryTrend.ageBands?.p75]
    .filter((value): value is number => value !== null && value !== undefined);
  const allValues = [...measurementValues, ...bandValues];
  if (allValues.length === 0) return null;

  const rawMin = Math.min(...allValues);
  const rawMax = Math.max(...allValues);
  const padding = Math.max(0.5, (rawMax - rawMin) * 0.15);
  const yMin = rawMin - padding;
  const yMax = rawMax + padding;

  const yFor = (value: number): number =>
    padTop + plotHeight - ((value - yMin) / (yMax - yMin)) * plotHeight;
  const xFor = (index: number): number =>
    padLeft + (categoryTrend.points.length <= 1 ? plotWidth / 2 : (index / (categoryTrend.points.length - 1)) * plotWidth);

  const linePoints = categoryTrend.points
    .map((pointItem, index) => {
      const numericValue = Number(pointItem.measurementValue);
      if (!Number.isFinite(numericValue)) return null;
      return `${xFor(index).toFixed(1)},${yFor(numericValue).toFixed(1)}`;
    })
    .filter((coord): coord is string => coord !== null)
    .join(" ");

  const latest = categoryTrend.points[categoryTrend.points.length - 1];
  const latestValue = latest ? Number(latest.measurementValue) : null;

  const selected = selectedIndex !== null ? categoryTrend.points[selectedIndex] : null;

  function moveSelection(direction: 1 | -1) {
    if (categoryTrend.points.length === 0) return;
    const start = selectedIndex ?? (direction === 1 ? -1 : categoryTrend.points.length);
    const candidate = start + direction;
    if (candidate < 0 || candidate >= categoryTrend.points.length) return;
    setSelectedIndex(candidate);
  }

  const firstDate = categoryTrend.points[0]?.sessionDate;
  const lastDate = categoryTrend.points[categoryTrend.points.length - 1]?.sessionDate;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <div className="flex flex-col">
          <p className="text-sm font-semibold text-text">
            {skillName} <span className="text-text-secondary font-normal">· {CATEGORY_LABELS[categoryTrend.category] ?? categoryTrend.category}</span>
          </p>
          {categoryTrend.ageBands ? (
            <p className="text-xs text-text-secondary">
              Age group ({categoryTrend.ageBands.bandCount} swimmers) · median {categoryTrend.ageBands.p50?.toFixed(1)}
            </p>
          ) : (
            <p className="text-xs text-text-secondary italic">Your trend only</p>
          )}
        </div>
        {latestValue !== null && Number.isFinite(latestValue) && (
          <span className="text-lg font-heading tabular-nums" style={{ color: "var(--color-accent)" }}>
            {latestValue.toFixed(1)}s
          </span>
        )}
      </div>
      <div
        className="rounded-[var(--radius-card)] overflow-hidden"
        style={{ backgroundColor: "var(--color-surface-soft)" }}
      >
        <style>{`
          .golf-chart-${titleId.replace(/[:]/g, "")} {
            width: 100%;
            height: ${PHONE_MIN_HEIGHT_PX}px;
            display: block;
          }
          @media (min-width: 769px) {
            .golf-chart-${titleId.replace(/[:]/g, "")} { height: ${TABLET_MIN_HEIGHT_PX}px; }
          }
        `}</style>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          role="img"
          aria-labelledby={titleId}
          className={`golf-chart-${titleId.replace(/[:]/g, "")} focus:outline-none`}
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight") {
              event.preventDefault();
              moveSelection(1);
            } else if (event.key === "ArrowLeft") {
              event.preventDefault();
              moveSelection(-1);
            } else if (event.key === "Escape") {
              setSelectedIndex(null);
            }
          }}
        >
          <title id={titleId}>{`${skillName} ${categoryTrend.category} golf score over time`}</title>
          {categoryTrend.ageBands?.p25 !== undefined &&
            categoryTrend.ageBands.p25 !== null &&
            categoryTrend.ageBands.p75 !== null &&
            categoryTrend.ageBands.p75 !== undefined && (
              <rect
                x={padLeft}
                y={Math.min(yFor(categoryTrend.ageBands.p25), yFor(categoryTrend.ageBands.p75))}
                width={plotWidth}
                height={Math.abs(yFor(categoryTrend.ageBands.p25) - yFor(categoryTrend.ageBands.p75))}
                fill="var(--color-accent)"
                fillOpacity={0.08}
                rx={2}
              />
            )}
          {categoryTrend.ageBands?.p50 !== undefined && categoryTrend.ageBands.p50 !== null && (
            <line
              x1={padLeft}
              y1={yFor(categoryTrend.ageBands.p50)}
              x2={width - padRight}
              y2={yFor(categoryTrend.ageBands.p50)}
              stroke="var(--color-text-secondary)"
              strokeWidth={0.75}
              strokeDasharray="4 4"
              opacity={0.75}
            />
          )}
          {linePoints && (
            <polyline
              points={linePoints}
              fill="none"
              stroke="var(--color-accent)"
              strokeWidth={2.25}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
          {categoryTrend.points.map((pointItem, index) => {
            const numericValue = Number(pointItem.measurementValue);
            if (!Number.isFinite(numericValue)) return null;
            const isSelected = index === selectedIndex;
            return (
              <g key={pointItem.sessionDate + pointItem.ratedAt}>
                <title>{`${formatSessionDate(pointItem.sessionDate)} · ${numericValue.toFixed(1)}s`}</title>
                <circle
                  cx={xFor(index)}
                  cy={yFor(numericValue)}
                  r={isSelected ? 6 : 4}
                  fill={isSelected ? "var(--color-accent)" : "var(--color-surface-soft)"}
                  stroke="var(--color-accent)"
                  strokeWidth={2}
                  style={{ transition: "r 180ms cubic-bezier(0.23, 1, 0.32, 1)" }}
                />
                <circle
                  cx={xFor(index)}
                  cy={yFor(numericValue)}
                  r={20}
                  fill="transparent"
                  pointerEvents="all"
                  onPointerEnter={() => setSelectedIndex(index)}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    setSelectedIndex(index);
                  }}
                  onFocus={() => setSelectedIndex(index)}
                  style={{ cursor: "pointer" }}
                  aria-label={`${formatSessionDate(pointItem.sessionDate)}, ${numericValue.toFixed(1)} seconds`}
                />
              </g>
            );
          })}
          <text x={padLeft - 6} y={padTop + 4} textAnchor="end" fontSize={11} fill="var(--color-text-secondary)" className="tabular-nums">
            {yMax.toFixed(1)}s
          </text>
          <text x={padLeft - 6} y={padTop + plotHeight + 2} textAnchor="end" fontSize={11} fill="var(--color-text-secondary)" className="tabular-nums">
            {yMin.toFixed(1)}s
          </text>
          {firstDate && (
            <text x={padLeft} y={height - 12} fontSize={11} fill="var(--color-text-secondary)">
              {formatMonthDay(firstDate)}
            </text>
          )}
          {lastDate && lastDate !== firstDate && (
            <text x={width - padRight} y={height - 12} fontSize={11} textAnchor="end" fill="var(--color-text-secondary)">
              {formatMonthDay(lastDate)}
            </text>
          )}
        </svg>
      </div>
      {selected && (
        <p className="text-xs text-text-secondary tabular-nums">
          {formatSessionDate(selected.sessionDate)} · {Number(selected.measurementValue).toFixed(1)}s
          {selected.grade !== null ? ` · grade ${selected.grade}` : ""}
        </p>
      )}
    </div>
  );
}
