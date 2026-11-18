"use client";

import { useState } from "react";
import type { ParentSkillProgress } from "@swim-app/shared";
import TrendLine from "@/components/TrendLine";
import SkillChart from "@/components/SkillChart";
import {
  formatRecency,
  isStaleBySessionDate,
  MIN_RATINGS_FOR_TREND,
} from "@/lib/progressRow";
import {
  currentLevelDisplay,
  currentLevelIsDanger,
  LEVEL_DESCRIPTIONS,
  SPECIAL_DESCRIPTIONS,
} from "./helpers";

interface ParentSkillProgressRowProps {
  skill: ParentSkillProgress;
  // ISO string captured server-side so recency text matches between SSR
  // and the client.
  nowIso?: string;
}

export default function ParentSkillProgressRow({ skill, nowIso }: ParentSkillProgressRowProps) {
  const [open, setOpen] = useState(false);

  const notAssessed = skill.ratedPerSide
    ? skill.currentLeft === null && skill.currentRight === null
    : skill.current === null;

  const now = nowIso !== undefined ? new Date(nowIso) : new Date();
  const latestPoint = skill.history[0];
  const recencyLabel = formatRecency(latestPoint?.sessionDate, now);
  const stale = isStaleBySessionDate(latestPoint?.sessionDate, now);
  // Only draw a trend line when there are enough effective ratings.
  const canShowTrend = skill.history.length >= MIN_RATINGS_FOR_TREND;

  function levelDescription(grade: number | null, notLegal: boolean, noConcept: boolean): string {
    if (notLegal) return SPECIAL_DESCRIPTIONS.dq;
    if (noConcept) return SPECIAL_DESCRIPTIONS.nc;
    if (grade !== null && grade in LEVEL_DESCRIPTIONS) return LEVEL_DESCRIPTIONS[grade] ?? "";
    return "";
  }

  return (
    <li
      id={`skill-${skill.slug}`}
      className="border-b border-border scroll-mt-24"
      style={{ opacity: stale ? 0.65 : 1 }}
      data-stale={stale ? "true" : undefined}
    >
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="w-full flex items-start justify-between py-2 text-sm text-left min-h-[44px] text-text"
        aria-expanded={open}
        disabled={notAssessed}
      >
        <span className="flex-1 flex flex-col gap-0.5">
          <span>{skill.name}</span>
          {notAssessed ? (
            <span className="text-xs text-text-secondary">Not rated yet</span>
          ) : recencyLabel ? (
            <span className="text-xs text-text-secondary">{recencyLabel}</span>
          ) : null}
        </span>
        <span className="flex items-center gap-2 shrink-0">
          {notAssessed ? null : skill.ratedPerSide ? (
            <>
              {skill.currentLeft !== null && (
                <span
                  className="text-xs font-semibold px-1.5 py-0.5 rounded"
                  style={{
                    backgroundColor: currentLevelIsDanger(skill.currentLeft)
                      ? "var(--color-danger)"
                      : "var(--color-border)",
                    color: currentLevelIsDanger(skill.currentLeft)
                      ? "var(--color-on-danger)"
                      : "var(--color-text)",
                  }}
                >
                  L {currentLevelDisplay(skill.currentLeft)}
                </span>
              )}
              {skill.currentRight !== null && (
                <span
                  className="text-xs font-semibold px-1.5 py-0.5 rounded"
                  style={{
                    backgroundColor: currentLevelIsDanger(skill.currentRight)
                      ? "var(--color-danger)"
                      : "var(--color-border)",
                    color: currentLevelIsDanger(skill.currentRight)
                      ? "var(--color-on-danger)"
                      : "var(--color-text)",
                  }}
                >
                  R {currentLevelDisplay(skill.currentRight)}
                </span>
              )}
            </>
          ) : skill.current !== null ? (
            <span
              className="text-xs font-semibold px-1.5 py-0.5 rounded"
              style={{
                backgroundColor: currentLevelIsDanger(skill.current)
                  ? "var(--color-danger)"
                  : "var(--color-border)",
                color: currentLevelIsDanger(skill.current)
                  ? "var(--color-on-danger)"
                  : "var(--color-text)",
              }}
            >
              {currentLevelDisplay(skill.current)}
            </span>
          ) : null}
          {canShowTrend && !open && (
            <TrendLine history={skill.history} />
          )}
          <span aria-hidden="true">{open ? "▲" : "▼"}</span>
        </span>
      </button>

      {open && (
        <div className="pb-4 flex flex-col gap-2">
          {skill.ratedPerSide ? (
            <>
              {skill.currentLeft !== null && (
                <p className="text-xs text-text-secondary">
                  Left: {levelDescription(skill.currentLeft.grade, skill.currentLeft.notLegal, skill.currentLeft.noConcept)}
                </p>
              )}
              {skill.currentRight !== null && (
                <p className="text-xs text-text-secondary">
                  Right: {levelDescription(skill.currentRight.grade, skill.currentRight.notLegal, skill.currentRight.noConcept)}
                </p>
              )}
            </>
          ) : skill.current !== null ? (
            <>
              <p className="text-xs text-text-secondary">
                {levelDescription(skill.current.grade, skill.current.notLegal, skill.current.noConcept)}
              </p>
              {skill.current.capacityValue !== null && (
                <p className="text-xs text-text-secondary">
                  Capacity: {skill.current.capacityValue} {skill.current.capacityUnit ?? ""}
                </p>
              )}
              {skill.current.measurementValue !== null && (
                <p className="text-xs text-text-secondary">
                  {skill.unit ?? "Measurement"}: {skill.current.measurementValue} {skill.current.measurementUnit ?? ""}
                </p>
              )}
            </>
          ) : null}
          <SkillChart history={skill.history} skillName={skill.name} />
        </div>
      )}
    </li>
  );
}
