"use client";

import type { SkillGrade } from "@swim-app/shared";
import { evaluationEditHref, type EvaluationEditContext } from "@/lib/evaluationEditHref";
import { realDateXFor, stepLinePath } from "@/lib/stepChart";

const CONTEXT_COLORS: Record<string, string> = {
  drill: "var(--color-text-secondary)",
  practice: "var(--color-accent)",
  race: "var(--color-danger)",
};

type ChartPoint = {
  id: string;
  grade: number | null;
  notLegal: boolean;
  noConcept: boolean;
  context: string;
  sessionDate: string;
  capacityValue: string | null;
  capacityUnit: string | null;
  measurementValue: string | null;
  measurementUnit: string | null;
  faultTags?: string[];
  // ADR 032: fields used by the Edit affordance and the hollow-ring
  // treatment on corrected points. sessionId is the session the point
  // belongs to; edited is true when this point is a correction leaf;
  // previousValue is the pre-correction grade walked one hop back.
  sessionId?: string;
  edited?: boolean;
  previousValue?: SkillGrade | null;
};

interface SkillChartProps {
  history: ChartPoint[];
  skillName: string;
  // ADR 032: serializable context (swimmerId, returnTo, skillSlug) used to
  // build per-point Edit links client-side. Pass this instead of a function
  // so the prop survives the server-to-client boundary.
  editContext?: EvaluationEditContext;
}

function previousValueLabel(previous: SkillGrade | null | undefined): string | null {
  if (previous === null || previous === undefined) return null;
  if (previous === "not_legal") return "Not legal";
  if (previous === "no_concept") return "No concept";
  return String(previous);
}

function formatSessionDate(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  // Build the instant at noon UTC so Intl.DateTimeFormat in the LA zone
  // (UTC-7/-8) always resolves to the same calendar day on server + client.
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Los_Angeles",
  }).format(new Date(Date.UTC(year!, month! - 1, day!, 12)));
}

export default function SkillChart({ history, skillName, editContext }: SkillChartProps) {
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

  // X-axis is spaced by real elapsed calendar days so cadence gaps are
  // visible on the chart. Step-line rendering means the grade is drawn as
  // "held" between sessions, not interpolated — the grade didn't drift
  // between measurements, it stayed what it was until a new measurement.
  const xForDate = realDateXFor(points.map((point) => point.sessionDate), padLeft, plotWidth);

  function yFor(value: number): number {
    return padTop + plotHeight - ((value / 5) * plotHeight);
  }

  const linePathPoints: Array<{ x: number; y: number }> = points
    .map((point) => {
      const numericGrade = point.notLegal ? 0 : point.noConcept ? null : point.grade;
      if (numericGrade === null) return null;
      return { x: xForDate(point.sessionDate), y: yFor(numericGrade) };
    })
    .filter((pointCoord): pointCoord is { x: number; y: number } => pointCoord !== null);

  const linePath = stepLinePath(linePathPoints);

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
        {linePath && (
          <path
            d={linePath}
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* Data points */}
        {points.map((point) => {
          const numericGrade = point.notLegal ? 0 : point.noConcept ? null : point.grade;
          const cx = xForDate(point.sessionDate);
          if (point.notLegal) {
            return (
              <text
                key={point.id}
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
          const color = CONTEXT_COLORS[point.context] ?? "var(--color-accent)";
          // Edited corrections render as a hollow ring: the surface-soft fill
          // shows through, with the context color as the stroke. Non-edited
          // points stay solid.
          return (
            <circle
              key={point.id}
              cx={cx}
              cy={cy}
              r={3}
              fill={point.edited ? "var(--color-surface-soft)" : color}
              stroke={point.edited ? color : "var(--color-surface-soft)"}
              strokeWidth={point.edited ? 1.5 : 1}
              data-testid={point.edited ? "skill-chart-edited-point" : undefined}
            />
          );
        })}
      </svg>

      {/* Per-point Edit affordances. newest first, matching the original
          history order. Hidden when no editContext is supplied (parent view). */}
      {editContext && (
        <ul
          className="flex flex-col divide-y"
          style={{ borderColor: "var(--color-border)", borderTopWidth: "1px", borderBottomWidth: "1px" }}
          data-testid="skill-chart-edit-list"
        >
          {history.map((point) => {
            const gradeLabel = point.notLegal
              ? "Not legal"
              : point.noConcept
                ? "No concept"
                : point.grade !== null
                  ? String(point.grade)
                  : "—";
            return (
              <li
                key={point.id}
                className="flex items-center justify-between gap-3 py-2 text-xs"
              >
                <span className="text-text-secondary tabular-nums flex items-center gap-2">
                  <span>{formatSessionDate(point.sessionDate)}</span>
                  <span className="capitalize">· {point.context}</span>
                  <span>· grade {gradeLabel}</span>
                  {point.edited && (
                    <span
                      className="font-semibold px-1.5 py-0.5 rounded-md"
                      style={{ backgroundColor: "var(--color-border)", color: "var(--color-text)" }}
                      data-testid="skill-chart-edited-pill"
                    >
                      Edited
                    </span>
                  )}
                </span>
                {point.sessionId && (
                  <a
                    href={evaluationEditHref(editContext, point.sessionId)}
                    className="min-h-[44px] inline-flex items-center font-semibold text-link hover:text-link-hover"
                    data-testid="skill-chart-edit-link"
                  >
                    Edit →
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}

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
          {points.map((point) => {
            const previousLabel = previousValueLabel(point.previousValue);
            return (
              <tr key={point.id}>
                <td>{formatSessionDate(point.sessionDate)}</td>
                <td className="capitalize">{point.context}</td>
                <td>
                  {point.notLegal
                    ? "Not legal (DQ)"
                    : point.noConcept
                      ? "No concept"
                      : String(point.grade ?? "—")}
                  {point.edited && previousLabel ? ` (edited, was ${previousLabel})` : point.edited ? " (edited)" : ""}
                </td>
                <td>
                  {point.capacityValue !== null
                    ? `${point.capacityValue} ${point.capacityUnit ?? ""}`
                    : "—"}
                </td>
                <td>
                  {point.measurementValue !== null
                    ? `${point.measurementValue} ${point.measurementUnit ?? ""}`
                    : "—"}
                </td>
                <td>{point.faultTags && point.faultTags.length > 0 ? point.faultTags.join(", ") : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
