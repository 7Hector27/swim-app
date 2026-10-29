"use client";

import { useId, useMemo, useRef, useState } from "react";
import { formatMonthDay, formatSessionDate } from "@/lib/progressCharts";
import { evaluationEditHref, type EvaluationEditContext } from "@/lib/evaluationEditHref";

interface HeroPoint {
  sessionDate: string;
  value: number | null;
  // ADR 032: when a point carries a sessionId and the caller supplies
  // editContext, the selected-point detail line renders an "Edit this
  // evaluation" link.
  sessionId?: string;
}

interface HeroTrendChartProps {
  points: HeroPoint[];
  title: string;
  current: number | null;
  trailingDeltaLabel?: string;
  // ADR 032: serializable context used to build the Edit link client-side.
  // Server callers must not pass a function here (crosses the RSC boundary).
  editContext?: EvaluationEditContext;
  // Minimum SVG viewBox height. 200 on phones, 260+ at tablet/desktop (via CSS
  // aspect-ratio). The viewBox gets the smaller baseline so phone layouts stay
  // compact; the responsive aspect-ratio stretches drawing on wider screens.
}

const PHONE_MIN_HEIGHT_PX = 200;
const TABLET_MIN_HEIGHT_PX = 260;

export default function HeroTrendChart({ points, title, current, trailingDeltaLabel, editContext }: HeroTrendChartProps) {
  const titleId = useId();
  const descId = useId();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const width = 720;
  const height = 320;
  const padLeft = 44;
  const padRight = 24;
  const padTop = 28;
  const padBottom = 44;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;

  const xFor = (index: number): number =>
    padLeft + (points.length <= 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
  const yFor = (value: number): number => padTop + plotHeight - ((value - 1) / 4) * plotHeight;

  const segments: Array<Array<{ x: number; y: number; index: number }>> = useMemo(() => {
    const out: Array<Array<{ x: number; y: number; index: number }>> = [];
    let currentSegment: Array<{ x: number; y: number; index: number }> = [];
    points.forEach((point, index) => {
      if (point.value === null) {
        if (currentSegment.length > 0) {
          out.push(currentSegment);
          currentSegment = [];
        }
      } else {
        currentSegment.push({ x: xFor(index), y: yFor(point.value), index });
      }
    });
    if (currentSegment.length > 0) out.push(currentSegment);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points]);

  const firstDate = points[0]?.sessionDate;
  const lastDate = points[points.length - 1]?.sessionDate;

  const selectedPoint = selectedIndex !== null ? points[selectedIndex] : null;

  function selectIndex(index: number) {
    const point = points[index];
    if (!point || point.value === null) return;
    setSelectedIndex(index);
  }

  function moveSelection(direction: 1 | -1) {
    if (points.length === 0) return;
    const start = selectedIndex ?? (direction === 1 ? -1 : points.length);
    for (let step = 1; step <= points.length; step++) {
      const candidate = start + direction * step;
      if (candidate < 0 || candidate >= points.length) continue;
      const point = points[candidate];
      if (point && point.value !== null) {
        setSelectedIndex(candidate);
        return;
      }
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <div className="flex flex-col gap-1">
          <p className="text-eyebrow uppercase tracking-wide font-semibold text-text-secondary">{title}</p>
          <div className="flex items-baseline gap-3">
            <span
              className="text-5xl tablet:text-6xl font-heading tabular-nums"
              style={{ color: "var(--color-accent)", fontVariationSettings: "\"SOFT\" 100, \"WONK\" 0" }}
            >
              {current !== null ? current : "—"}
            </span>
            <span className="text-sm text-text-secondary">of 5</span>
          </div>
        </div>
        {trailingDeltaLabel && (
          <span className="text-xs text-text-secondary tabular-nums">{trailingDeltaLabel}</span>
        )}
      </div>

      <div
        className="rounded-[var(--radius-card)] overflow-hidden"
        style={{
          backgroundColor: "var(--color-surface-soft)",
          minHeight: `${PHONE_MIN_HEIGHT_PX}px`,
        }}
      >
        <style>{`
          .hero-chart-svg {
            width: 100%;
            height: ${PHONE_MIN_HEIGHT_PX}px;
            display: block;
          }
          @media (min-width: 769px) {
            .hero-chart-svg { height: ${TABLET_MIN_HEIGHT_PX}px; }
          }
          @media (min-width: 1248px) {
            .hero-chart-svg { height: 300px; }
          }
        `}</style>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          role="img"
          aria-labelledby={titleId}
          aria-describedby={descId}
          className="hero-chart-svg focus:outline-none"
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
          <title id={titleId}>{`${title} over time`}</title>
          <desc id={descId}>{
            firstDate && lastDate
              ? `Line chart from ${formatSessionDate(firstDate)} to ${formatSessionDate(lastDate)}. Values 1 to 5.`
              : "Not enough data to draw a line."
          }</desc>

          {[1, 2, 3, 4, 5].map((level) => (
            <g key={level}>
              <line
                x1={padLeft}
                y1={yFor(level)}
                x2={width - padRight}
                y2={yFor(level)}
                stroke="var(--color-border)"
                strokeWidth={0.75}
                strokeDasharray={level === 3 ? "0" : "3 4"}
                opacity={level === 3 ? 0.9 : 0.5}
              />
              <text
                x={padLeft - 8}
                y={yFor(level) + 4}
                textAnchor="end"
                fontSize={12}
                fill="var(--color-text-secondary)"
                className="tabular-nums"
              >
                {level}
              </text>
            </g>
          ))}

          {segments.map((segment, segmentIndex) => (
            <g key={segmentIndex}>
              <polyline
                points={segment.map((pointCoord) => `${pointCoord.x},${pointCoord.y}`).join(" ")}
                fill="none"
                stroke="var(--color-accent)"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          ))}

          {points.map((point, index) => {
            if (point.value === null) return null;
            const cx = xFor(index);
            const cy = yFor(point.value);
            const isSelected = index === selectedIndex;
            return (
              <g key={index}>
                <title>{`${formatSessionDate(point.sessionDate)} · ${point.value}`}</title>
                <circle
                  cx={cx}
                  cy={cy}
                  r={isSelected ? 7 : 4.5}
                  fill={isSelected ? "var(--color-accent)" : "var(--color-surface-soft)"}
                  stroke="var(--color-accent)"
                  strokeWidth={2.25}
                  style={{ transition: "r 180ms cubic-bezier(0.23, 1, 0.32, 1)" }}
                />
                <circle
                  cx={cx}
                  cy={cy}
                  r={18}
                  fill="transparent"
                  pointerEvents="all"
                  style={{ cursor: "pointer" }}
                  onPointerEnter={() => selectIndex(index)}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    selectIndex(index);
                  }}
                  onFocus={() => selectIndex(index)}
                  aria-label={`${formatSessionDate(point.sessionDate)}, value ${point.value}`}
                />
              </g>
            );
          })}

          {firstDate && (
            <text x={padLeft} y={height - 14} fontSize={12} fill="var(--color-text-secondary)">
              {formatMonthDay(firstDate)}
            </text>
          )}
          {lastDate && lastDate !== firstDate && (
            <text x={width - padRight} y={height - 14} fontSize={12} textAnchor="end" fill="var(--color-text-secondary)">
              {formatMonthDay(lastDate)}
            </text>
          )}

          {selectedPoint && selectedPoint.value !== null && selectedIndex !== null && (
            <PointTooltip
              x={xFor(selectedIndex)}
              y={yFor(selectedPoint.value)}
              label={formatSessionDate(selectedPoint.sessionDate)}
              value={String(selectedPoint.value)}
              viewBoxWidth={width}
            />
          )}
        </svg>
      </div>

      {selectedPoint && selectedPoint.value !== null && (
        <p className="text-xs tabular-nums text-text-secondary flex items-center flex-wrap gap-x-3 gap-y-1">
          <span>
            {formatSessionDate(selectedPoint.sessionDate)} · grade {selectedPoint.value}
          </span>
          {editContext && selectedPoint.sessionId && (
            <a
              href={evaluationEditHref(editContext, selectedPoint.sessionId)}
              className="text-link hover:text-link-hover font-semibold"
              data-testid="hero-trend-edit-link"
            >
              Edit this evaluation →
            </a>
          )}
        </p>
      )}
    </div>
  );
}

interface PointTooltipProps {
  x: number;
  y: number;
  label: string;
  value: string;
  viewBoxWidth: number;
}

function PointTooltip({ x, y, label, value, viewBoxWidth }: PointTooltipProps) {
  const boxWidth = 140;
  const boxHeight = 44;
  const padding = 8;
  const prefersRight = x + boxWidth / 2 > viewBoxWidth - padding;
  const prefersLeft = x - boxWidth / 2 < padding;
  const boxX = prefersRight ? x - boxWidth - 12 : prefersLeft ? x + 12 : x - boxWidth / 2;
  const boxY = y - boxHeight - 16;
  const safeY = boxY < padding ? y + 16 : boxY;
  return (
    <g pointerEvents="none">
      <rect
        x={boxX}
        y={safeY}
        width={boxWidth}
        height={boxHeight}
        rx={10}
        fill="var(--color-section)"
        stroke="var(--color-accent)"
        strokeWidth={1}
      />
      <text
        x={boxX + boxWidth / 2}
        y={safeY + 18}
        textAnchor="middle"
        fontSize={12}
        fill="var(--color-text-on-section)"
      >
        {label}
      </text>
      <text
        x={boxX + boxWidth / 2}
        y={safeY + 34}
        textAnchor="middle"
        fontSize={14}
        fontWeight={700}
        fill="var(--color-accent-on-section)"
        className="tabular-nums"
      >
        Grade {value}
      </text>
    </g>
  );
}
