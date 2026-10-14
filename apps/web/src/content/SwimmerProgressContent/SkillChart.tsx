"use client";

import type { ProgressRatingPoint } from "@swim-app/shared";
import { formatSessionDate } from "./helpers";

const CONTEXT_COLORS: Record<string, string> = {
  drill: "var(--color-text-secondary)",
  practice: "var(--color-accent)",
  race: "var(--color-danger)",
};

interface SkillChartProps {
  history: ProgressRatingPoint[];
  skillName: string;
}

export default function SkillChart({ history, skillName }: SkillChartProps) {
  if (history.length === 0) {
    return <p className="text-xs text-text-secondary py-2">No ratings yet.</p>;
  }

  // oldest to newest for display
  const points = [...history].reverse();

  const width = 280;
  const height = 80;
  const padLeft = 20;
  const padRight = 8;
  const padTop = 8;
  const padBottom = 8;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;

  function xFor(index: number): number {
    return padLeft + (index / Math.max(points.length - 1, 1)) * plotWidth;
  }

  function yFor(value: number): number {
    return padTop + plotHeight - ((value / 5) * plotHeight);
  }

  const linePoints = points
    .map((p, i) => {
      const numericGrade = p.notLegal ? 0 : p.noConcept ? null : p.grade;
      if (numericGrade === null) return null;
      return `${xFor(i).toFixed(1)},${yFor(numericGrade).toFixed(1)}`;
    })
    .filter((c): c is string => c !== null)
    .join(" ");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-3 text-xs text-text-secondary flex-wrap">
        <span style={{ color: CONTEXT_COLORS["drill"] }}>● Drill</span>
        <span style={{ color: CONTEXT_COLORS["practice"] }}>● Practice</span>
        <span style={{ color: CONTEXT_COLORS["race"] }}>● Race</span>
      </div>

      <svg
        width="100%"
        viewBox={`0 0 ${width} ${height}`}
        aria-label={`${skillName} progress chart`}
        role="img"
        className="border border-border rounded"
        style={{ backgroundColor: "var(--color-surface-soft)" }}
      >
        {/* Y-axis labels */}
        {[1, 2, 3, 4, 5].map((level) => (
          <text
            key={level}
            x={padLeft - 4}
            y={yFor(level) + 3}
            textAnchor="end"
            fontSize={8}
            fill="var(--color-text-secondary)"
          >
            {level}
          </text>
        ))}

        {/* Grid lines */}
        {[1, 2, 3, 4, 5].map((level) => (
          <line
            key={level}
            x1={padLeft}
            y1={yFor(level)}
            x2={width - padRight}
            y2={yFor(level)}
            stroke="var(--color-border)"
            strokeWidth={0.5}
          />
        ))}

        {/* Trend line */}
        {linePoints && (
          <polyline
            points={linePoints}
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* Data points */}
        {points.map((p, i) => {
          const numericGrade = p.notLegal ? 0 : p.noConcept ? null : p.grade;
          const cx = xFor(i);
          if (p.notLegal) {
            return (
              <text
                key={p.id}
                x={cx}
                y={yFor(0) + 4}
                textAnchor="middle"
                fontSize={7}
                fill="var(--color-danger)"
              >
                DQ
              </text>
            );
          }
          if (numericGrade === null) return null;
          const cy = yFor(numericGrade);
          return (
            <circle
              key={p.id}
              cx={cx}
              cy={cy}
              r={3}
              fill={CONTEXT_COLORS[p.context] ?? "var(--color-accent)"}
              stroke="var(--color-surface-soft)"
              strokeWidth={1}
            />
          );
        })}
      </svg>

      {/* Accessible table */}
      <table className="sr-only">
        <caption>{skillName} rating history</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Context</th>
            <th scope="col">Grade</th>
            <th scope="col">Capacity</th>
            <th scope="col">Measurement</th>
            <th scope="col">Fault tags</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.id}>
              <td>{formatSessionDate(p.sessionDate)}</td>
              <td className="capitalize">{p.context}</td>
              <td>
                {p.notLegal
                  ? "Not legal (DQ)"
                  : p.noConcept
                    ? "No concept"
                    : String(p.grade ?? "—")}
              </td>
              <td>
                {p.capacityValue !== null
                  ? `${p.capacityValue} ${p.capacityUnit ?? ""}`
                  : "—"}
              </td>
              <td>
                {p.measurementValue !== null
                  ? `${p.measurementValue} ${p.measurementUnit ?? ""}`
                  : "—"}
              </td>
              <td>{p.faultTags.length > 0 ? p.faultTags.join(", ") : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
