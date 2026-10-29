"use client";

import { useId, useRef, useState } from "react";
import type { StartGradeResult } from "@swim-app/shared";
import { formatMonthDay, formatSessionDate } from "../helpers";

interface StartProgressionProps {
  name: string;
  points: Array<{ sessionDate: string; grade: StartGradeResult }>;
}

const PHONE_MIN_HEIGHT_PX = 200;
const TABLET_MIN_HEIGHT_PX = 260;

export default function StartProgression({ name, points }: StartProgressionProps) {
  const titleId = useId();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const width = 480;
  const height = 240;
  const padLeft = 36;
  const padRight = 20;
  const padTop = 24;
  const padBottom = 36;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;

  const xFor = (index: number): number =>
    padLeft + (points.length <= 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
  const yFor = (value: number): number => padTop + plotHeight - ((value - 1) / 4) * plotHeight;

  const latest = points[points.length - 1]?.grade;

  const gradedSegments: Array<Array<{ x: number; y: number; index: number }>> = [];
  const bands: Array<{ fromX: number; toX: number; kind: "not_legal" | "in_progress" | "no_concept" }> = [];

  let currentSegment: Array<{ x: number; y: number; index: number }> = [];
  let currentBand: { startIndex: number; kind: "not_legal" | "in_progress" | "no_concept" } | null = null;

  const flushSegment = () => {
    if (currentSegment.length > 0) {
      gradedSegments.push(currentSegment);
      currentSegment = [];
    }
  };
  const flushBand = (endIndex: number) => {
    if (currentBand) {
      bands.push({ fromX: xFor(currentBand.startIndex), toX: xFor(endIndex), kind: currentBand.kind });
      currentBand = null;
    }
  };

  points.forEach((pointItem, index) => {
    const grade = pointItem.grade;
    if (grade.status === "graded") {
      flushBand(index);
      currentSegment.push({ x: xFor(index), y: yFor(grade.grade), index });
    } else {
      flushSegment();
      if (!currentBand) currentBand = { startIndex: index, kind: grade.status };
      else if (currentBand.kind !== grade.status) {
        flushBand(index);
        currentBand = { startIndex: index, kind: grade.status };
      }
    }
  });
  flushSegment();
  if (currentBand) flushBand(points.length - 1);

  const selected = selectedIndex !== null ? points[selectedIndex] : null;

  function selectIndex(index: number) {
    const point = points[index];
    if (!point) return;
    setSelectedIndex(index);
  }

  function moveSelection(direction: 1 | -1) {
    if (points.length === 0) return;
    const start = selectedIndex ?? (direction === 1 ? -1 : points.length);
    const candidate = start + direction;
    if (candidate < 0 || candidate >= points.length) return;
    setSelectedIndex(candidate);
  }

  const firstDate = points[0]?.sessionDate;
  const lastDate = points[points.length - 1]?.sessionDate;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-text">{name}</p>
        <StatusBadge grade={latest} />
      </div>
      <div
        className="rounded-[var(--radius-card)] overflow-hidden"
        style={{ backgroundColor: "var(--color-surface-soft)" }}
      >
        <style>{`
          .start-chart-${titleId.replace(/[:]/g, "")} {
            width: 100%;
            height: ${PHONE_MIN_HEIGHT_PX}px;
            display: block;
          }
          @media (min-width: 769px) {
            .start-chart-${titleId.replace(/[:]/g, "")} { height: ${TABLET_MIN_HEIGHT_PX}px; }
          }
        `}</style>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          role="img"
          aria-labelledby={titleId}
          className={`start-chart-${titleId.replace(/[:]/g, "")} focus:outline-none`}
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
          <title id={titleId}>{`${name} grade progression`}</title>
          {bands.map((band, index) => (
            <rect
              key={`band-${index}`}
              x={band.fromX}
              y={padTop}
              width={Math.max(2, band.toX - band.fromX)}
              height={plotHeight}
              fill={band.kind === "not_legal" ? "var(--color-danger)" : "var(--color-border)"}
              opacity={band.kind === "not_legal" ? 0.14 : 0.5}
              rx={6}
            />
          ))}
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
                x={padLeft - 6}
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
          {gradedSegments.map((segment, segmentIndex) => (
            <g key={segmentIndex}>
              <polyline
                points={segment.map((pointCoord) => `${pointCoord.x},${pointCoord.y}`).join(" ")}
                fill="none"
                stroke="var(--color-accent)"
                strokeWidth={2.25}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          ))}
          {points.map((pointItem, index) => {
            const grade = pointItem.grade;
            if (grade.status !== "graded") return null;
            const cx = xFor(index);
            const cy = yFor(grade.grade);
            const isSelected = index === selectedIndex;
            return (
              <g key={`${pointItem.sessionDate}-${index}`}>
                <title>{`${formatSessionDate(pointItem.sessionDate)} · grade ${grade.grade}`}</title>
                <circle
                  cx={cx}
                  cy={cy}
                  r={isSelected ? 6 : 4}
                  fill={isSelected ? "var(--color-accent)" : "var(--color-surface-soft)"}
                  stroke="var(--color-accent)"
                  strokeWidth={2}
                  style={{ transition: "r 180ms cubic-bezier(0.23, 1, 0.32, 1)" }}
                />
                <circle
                  cx={cx}
                  cy={cy}
                  r={20}
                  fill="transparent"
                  pointerEvents="all"
                  onPointerEnter={() => selectIndex(index)}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    selectIndex(index);
                  }}
                  onFocus={() => selectIndex(index)}
                  style={{ cursor: "pointer" }}
                  aria-label={`${formatSessionDate(pointItem.sessionDate)}, grade ${grade.grade}`}
                />
              </g>
            );
          })}

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
          {formatSessionDate(selected.sessionDate)} · {statusLabel(selected.grade)}
        </p>
      )}
    </div>
  );
}

function statusLabel(grade: StartGradeResult): string {
  switch (grade.status) {
    case "graded":
      return `Grade ${grade.grade}`;
    case "not_legal":
      return "Not legal";
    case "in_progress":
      return "In progress";
    case "no_concept":
      return "No concept";
  }
}

function StatusBadge({ grade }: { grade: StartGradeResult | undefined }) {
  if (!grade) return null;
  const isDanger = grade.status === "not_legal";
  const label = statusLabel(grade);
  return (
    <span
      className="text-xs font-semibold px-2 py-0.5 rounded-full tabular-nums"
      style={{
        backgroundColor: isDanger ? "var(--color-danger)" : "var(--color-border)",
        color: isDanger ? "var(--color-on-accent)" : "var(--color-text)",
      }}
    >
      {label}
    </span>
  );
}
