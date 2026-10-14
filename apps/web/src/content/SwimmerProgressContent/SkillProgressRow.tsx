"use client";

import { useState } from "react";
import type { SkillProgress } from "@swim-app/shared";
import TrendLine from "./TrendLine";
import SkillChart from "./SkillChart";
import { currentLevelDisplay, currentLevelIsDanger } from "./helpers";

interface SkillProgressRowProps {
  skill: SkillProgress;
}

export default function SkillProgressRow({ skill }: SkillProgressRowProps) {
  const [open, setOpen] = useState(false);

  const notAssessed = skill.ratedPerSide
    ? skill.currentLeft === null && skill.currentRight === null
    : skill.current === null;

  return (
    <li className="border-b border-border">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="w-full flex items-center justify-between py-2 text-sm text-left min-h-[44px] text-text"
        aria-expanded={open}
      >
        <span className="flex-1">{skill.name}</span>
        <span className="flex items-center gap-2 shrink-0">
          {notAssessed ? (
            <span className="text-xs text-text-secondary">Not assessed</span>
          ) : skill.ratedPerSide ? (
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
          {skill.history.length >= 2 && !open && (
            <TrendLine history={skill.history} />
          )}
          <span aria-hidden="true">{open ? "▲" : "▼"}</span>
        </span>
      </button>

      {open && (
        <div className="pb-4">
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
          <SkillChart history={skill.history} skillName={skill.name} />
        </div>
      )}
    </li>
  );
}
