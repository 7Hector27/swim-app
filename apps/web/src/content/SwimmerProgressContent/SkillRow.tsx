"use client";

import { useState } from "react";
import type { SkillCurrentLevel, SkillGrade, SwimmerProgressResponse } from "@swim-app/shared";
import TrendLine from "@/components/TrendLine";
import LevelLadder from "@/components/LevelLadder";
import { evaluationEditHref, type EvaluationEditContext } from "@/lib/evaluationEditHref";
import {
  formatRecency,
  isStaleBySessionDate,
} from "@/lib/progressRow";
import { evaluateHrefFor } from "./helpers";

type SkillProgress = SwimmerProgressResponse["skills"][number];

interface SkillRowProps {
  skill: SkillProgress;
  swimmerId: string;
  // ISO string captured server-side so recency text is identical during SSR
  // and client hydration. Omitting it lets tests fall back to real time.
  nowIso?: string;
  // ADR 032: serializable edit context (swimmerId + returnTo). SkillRow adds
  // the skill slug here before handing it to SkillChart so the deep link
  // scrolls to this skill.
  editContext?: EvaluationEditContext;
}

export default function SkillRow({ skill, swimmerId, nowIso, editContext }: SkillRowProps) {
  const [open, setOpen] = useState(false);
  const latestPoint = skill.history[0];
  const now = nowIso !== undefined ? new Date(nowIso) : new Date();
  const recencyLabel = formatRecency(latestPoint?.sessionDate, now);
  const href = evaluateHrefFor(swimmerId, skill.slug);
  // Pass 3: never-rated and stale states. A skill is "never rated" when
  // the current level is null (both sides null for per-side skills).
  const neverRated = skill.ratedPerSide
    ? skill.currentLeft === null && skill.currentRight === null
    : skill.current === null;
  const stale = isStaleBySessionDate(latestPoint?.sessionDate, now);
  // Draw the inline trend line whenever there's any history. The 3-rating
  // minimum this used to gate was dropped when the ladder became the
  // detailed view — TrendLine still bails internally when it has fewer
  // than two numeric points, so a single-rating row just omits the
  // sparkline on its own.
  const canShowTrend = skill.history.length >= 1;

  return (
    <li
      id={`skill-${skill.slug}`}
      className="flex flex-col border-b scroll-mt-24"
      style={{
        borderColor: "var(--color-border)",
        opacity: stale ? 0.65 : 1,
      }}
      data-stale={stale ? "true" : undefined}
    >
      <div className="flex items-center gap-3 py-3 min-h-[44px]">
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          aria-label={`${open ? "Collapse" : "Expand"} ${skill.name} history`}
          className="shrink-0 w-6 h-6 inline-flex items-center justify-center rounded-full text-xs"
          style={{ color: "var(--color-text-secondary)" }}
          disabled={neverRated}
        >
          <span aria-hidden="true" style={{ transition: "transform 180ms cubic-bezier(0.23, 1, 0.32, 1)", transform: open ? "rotate(90deg)" : "rotate(0deg)" }}>
            ›
          </span>
        </button>
        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
          <a
            href={href}
            className="text-sm font-semibold truncate hover:underline"
            style={{ color: "var(--color-text)" }}
          >
            {skill.name}
          </a>
          {neverRated ? (
            <span className="text-xs text-text-secondary">Not rated yet</span>
          ) : recencyLabel ? (
            <span className="text-xs text-text-secondary">{recencyLabel}</span>
          ) : null}
        </div>

        {!neverRated && (
          skill.ratedPerSide ? (
            <SideBadges left={skill.currentLeft} right={skill.currentRight} />
          ) : (
            <SingleBadge level={skill.current} />
          )
        )}

        <div className="hidden tablet:block">
          {canShowTrend && (
            <TrendLine
              history={skill.history.map((point) => ({
                grade: point.grade,
                notLegal: point.notLegal,
                noConcept: point.noConcept,
              }))}
            />
          )}
        </div>
      </div>

      {open && (
        <div className="pb-4 pl-9 flex flex-col gap-3">
          {skill.current !== null && skill.current.capacityValue !== null && (
            <p className="text-xs text-text-secondary">
              Capacity: {skill.current.capacityValue} {skill.current.capacityUnit ?? ""}
            </p>
          )}
          {skill.current !== null && skill.current.measurementValue !== null && (
            <p className="text-xs text-text-secondary">
              {skill.unit ?? "Measurement"}: {skill.current.measurementValue} {skill.current.measurementUnit ?? ""}
            </p>
          )}
          {skill.history.length > 0 ? (
            <>
              <LevelLadder
                skillName={skill.name}
                history={skill.history}
                ratedPerSide={skill.ratedPerSide}
                levelDescriptors={skill.levelDescriptors ?? undefined}
              />
              {editContext && (
                <CoachSkillEditList
                  history={skill.history}
                  editContext={{ ...editContext, skillSlug: skill.slug }}
                />
              )}
            </>
          ) : (
            <p className="text-xs text-text-secondary italic">No rated sessions yet.</p>
          )}
        </div>
      )}
    </li>
  );
}

// Coach-only per-rating detail list, rendered under the ladder. Keeps the
// capabilities that used to live inside SkillChart's edit list — per-point
// Edit link, "Edited" treatment with the previous value, and the fault
// tags the coach view is allowed to surface. Parent view omits this list
// entirely by not passing editContext to SkillRow.
type SkillHistoryPoint = SwimmerProgressResponse["skills"][number]["history"][number];

function CoachSkillEditList({
  history,
  editContext,
}: {
  history: SkillHistoryPoint[];
  editContext: EvaluationEditContext;
}) {
  function formatPointDate(dateStr: string): string {
    const [year, month, day] = dateStr.split("-").map(Number);
    if (year === undefined || month === undefined || day === undefined) return dateStr;
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "America/Los_Angeles",
    }).format(new Date(Date.UTC(year, month - 1, day, 12)));
  }
  function previousValueLabel(previous: SkillGrade | null | undefined): string | null {
    if (previous === null || previous === undefined) return null;
    if (previous === "not_legal") return "Not legal";
    if (previous === "no_concept") return "No concept";
    return String(previous);
  }
  return (
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
        const previousLabel = previousValueLabel(point.previousValue);
        return (
          <li key={point.id} className="flex flex-col gap-1 py-2 text-xs">
            <div className="flex items-center justify-between gap-3">
              <span className="text-text-secondary tabular-nums flex items-center gap-2 flex-wrap">
                <span>{formatPointDate(point.sessionDate)}</span>
                <span className="capitalize">· {point.context}</span>
                <span>· grade {gradeLabel}</span>
                {point.edited && (
                  <span
                    className="font-semibold px-1.5 py-0.5 rounded-md"
                    style={{ backgroundColor: "var(--color-border)", color: "var(--color-text)" }}
                    data-testid="skill-chart-edited-pill"
                  >
                    {previousLabel ? `Edited (was ${previousLabel})` : "Edited"}
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
            </div>
            {point.faultTags && point.faultTags.length > 0 && (
              <span className="text-text-secondary">
                Faults: {point.faultTags.join(", ")}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

type Level = SkillCurrentLevel | null;

function SingleBadge({ level }: { level: Level }) {
  if (level === null) {
    return <span className="text-xs text-text-secondary shrink-0">Not assessed</span>;
  }
  if (level.notLegal) {
    return <Pill label="Not legal" tone="danger" />;
  }
  if (level.noConcept) {
    return <Pill label="No concept" tone="muted" />;
  }
  if (level.grade === null) return <span className="text-xs text-text-secondary">—</span>;
  return <Pill label={String(level.grade)} tone="neutral" />;
}

function SideBadges({ left, right }: { left: Level; right: Level }) {
  const leftGrade = sideGradeNumeric(left);
  const rightGrade = sideGradeNumeric(right);
  const asymmetry =
    leftGrade !== null && rightGrade !== null ? Math.abs(leftGrade - rightGrade) : null;

  return (
    <div className="flex items-center gap-1 shrink-0">
      <SideBadge label="L" level={left} />
      <AsymmetryDot asymmetry={asymmetry} />
      <SideBadge label="R" level={right} />
    </div>
  );
}

function SideBadge({ label, level }: { label: "L" | "R"; level: Level }) {
  if (level === null) {
    return (
      <span
        className="text-xs px-1.5 py-0.5 rounded-md border tabular-nums"
        style={{ borderColor: "var(--color-border)", color: "var(--color-text-secondary)" }}
      >
        {label} —
      </span>
    );
  }
  if (level.notLegal) return <Pill label={`${label} Not legal`} tone="danger" />;
  if (level.noConcept) return <Pill label={`${label} No concept`} tone="muted" />;
  return <Pill label={`${label} ${level.grade ?? "—"}`} tone="neutral" />;
}

function AsymmetryDot({ asymmetry }: { asymmetry: number | null }) {
  if (asymmetry === null || asymmetry === 0) {
    return <span className="w-1 h-1 rounded-full shrink-0" style={{ backgroundColor: "var(--color-border)" }} aria-hidden="true" />;
  }
  const tone = asymmetry >= 2 ? "var(--color-danger)" : "var(--color-text-secondary)";
  return (
    <span
      className="text-[10px] font-semibold px-1 rounded-md tabular-nums shrink-0"
      style={{ color: tone, backgroundColor: "var(--color-surface-soft)" }}
      aria-label={`Side gap of ${asymmetry}`}
    >
      Δ{asymmetry}
    </span>
  );
}

function sideGradeNumeric(level: Level): number | null {
  if (level === null) return null;
  if (level.notLegal || level.noConcept) return null;
  return level.grade;
}

function Pill({ label, tone }: { label: string; tone: "neutral" | "danger" | "muted" }) {
  const styles: Record<typeof tone, { bg: string; color: string }> = {
    neutral: { bg: "var(--color-border)", color: "var(--color-text)" },
    danger: { bg: "var(--color-danger)", color: "var(--color-on-accent)" },
    muted: { bg: "var(--color-surface-soft)", color: "var(--color-text-secondary)" },
  };
  return (
    <span
      className="text-xs font-semibold px-2 py-0.5 rounded-md tabular-nums whitespace-nowrap"
      style={{ backgroundColor: styles[tone].bg, color: styles[tone].color }}
    >
      {label}
    </span>
  );
}
