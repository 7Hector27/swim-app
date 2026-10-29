"use client";

import { useState } from "react";
import type { SkillCurrentLevel, SwimmerProgressResponse } from "@swim-app/shared";
import TrendLine from "@/components/TrendLine";
import SkillChart from "@/components/SkillChart";
import type { EvaluationEditContext } from "@/lib/evaluationEditHref";
import { evaluateHrefFor, formatRecency } from "./helpers";

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

  return (
    <li
      className="flex flex-col border-b"
      style={{ borderColor: "var(--color-border)" }}
    >
      <div className="flex items-center gap-3 py-3 min-h-[44px]">
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          aria-label={`${open ? "Collapse" : "Expand"} ${skill.name} history`}
          className="shrink-0 w-6 h-6 inline-flex items-center justify-center rounded-full text-xs"
          style={{ color: "var(--color-text-secondary)" }}
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
          {recencyLabel && (
            <span className="text-xs text-text-secondary">{recencyLabel}</span>
          )}
        </div>

        {skill.ratedPerSide ? (
          <SideBadges left={skill.currentLeft} right={skill.currentRight} />
        ) : (
          <SingleBadge level={skill.current} />
        )}

        <div className="hidden tablet:block">
          {skill.history.length >= 2 && (
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
        <div className="pb-4 pl-9">
          {skill.current !== null && skill.current.capacityValue !== null && (
            <p className="text-xs text-text-secondary mb-2">
              Capacity: {skill.current.capacityValue} {skill.current.capacityUnit ?? ""}
            </p>
          )}
          {skill.current !== null && skill.current.measurementValue !== null && (
            <p className="text-xs text-text-secondary mb-2">
              {skill.unit ?? "Measurement"}: {skill.current.measurementValue} {skill.current.measurementUnit ?? ""}
            </p>
          )}
          {skill.history.length > 0 ? (
            <SkillChart
              history={skill.history}
              skillName={skill.name}
              {...(editContext && { editContext: { ...editContext, skillSlug: skill.slug } })}
            />
          ) : (
            <p className="text-xs text-text-secondary italic">No rated sessions yet.</p>
          )}
        </div>
      )}
    </li>
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
