"use client";

import { useState } from "react";
import type { ParentSkillProgress } from "@swim-app/shared";
import LevelLadder, { LadderDetails } from "@/components/LevelLadder";
import { isStaleBySessionDate } from "@/lib/progressRow";
import { rowChangeText, rowLevelLabel, rowPipCount, rowSideBreakdown } from "./helpers";

interface ParentSkillProgressRowProps {
  skill: ParentSkillProgress;
  // ISO string captured server-side so stale calculations stay stable
  // across SSR + hydration.
  nowIso?: string;
}

// New parent skill row. Each row shows the skill name, the current level
// name, a change-vs-first phrase ("up 2", "holding steady", "left 3,
// right 2"), and a five-step pip bar filled to the current level. Tapping
// the row opens the shared LevelLadder with chips + Next-level descriptor
// text. The 6-week stale rule and the "Not rated yet" treatment carry over
// from the previous row — parents still see the skill but greyed when the
// latest rating is older than six weeks.
export default function ParentSkillProgressRow({ skill, nowIso }: ParentSkillProgressRowProps) {
  const [open, setOpen] = useState(false);

  const notAssessed = skill.ratedPerSide
    ? skill.currentLeft === null && skill.currentRight === null
    : skill.current === null;

  const now = nowIso !== undefined ? new Date(nowIso) : new Date();
  const latestPoint = skill.history[0];
  const stale = isStaleBySessionDate(latestPoint?.sessionDate, now);

  const levelLabel = rowLevelLabel(skill);
  const changeText = rowChangeText(skill);
  const pipCount = rowPipCount(skill);
  const sideBreakdown = rowSideBreakdown(skill);

  return (
    <li
      id={`skill-${skill.slug}`}
      className="scroll-mt-24"
      style={{
        opacity: stale ? 0.65 : 1,
        borderTopWidth: "1px",
        borderTopColor: open ? "var(--color-accent)" : "var(--color-border)",
      }}
      data-stale={stale ? "true" : undefined}
    >
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="w-full grid gap-3 items-center py-3 min-h-[44px] text-left"
        style={{ gridTemplateColumns: "minmax(0, 1fr) 72px" }}
        aria-expanded={open}
        disabled={notAssessed}
        data-testid={`parent-skill-row-${skill.slug}`}
      >
        <span className="flex flex-col gap-0.5 min-w-0">
          <span
            className="text-sm font-semibold truncate"
            style={{ color: open ? "var(--color-accent)" : "var(--color-text)" }}
          >
            {skill.name}
          </span>
          {notAssessed ? (
            <span className="text-xs text-text-secondary">Not rated yet</span>
          ) : (
            <>
              <span className="text-xs text-text-secondary">
                {levelLabel}
                {changeText !== null && (
                  <>
                    {" · "}
                    <span data-testid={`parent-skill-change-${skill.slug}`}>{changeText}</span>
                  </>
                )}
              </span>
              {sideBreakdown !== null && (
                <span
                  className="text-[0.6875rem] text-text-secondary opacity-80"
                  data-testid={`parent-skill-sides-${skill.slug}`}
                >
                  {sideBreakdown}
                </span>
              )}
            </>
          )}
        </span>
        <LevelPips count={pipCount} />
      </button>

      {open && (
        <div className="pb-4 pt-1">
          {skill.history.length > 0 ? (
            <div
              className="rounded-lg p-4 flex flex-col gap-4 tablet:grid tablet:gap-6 tablet:[grid-template-columns:minmax(0,400px)_minmax(0,1fr)] tablet:items-start"
              style={{ backgroundColor: "var(--color-surface-soft)" }}
              data-testid="skill-row-opened-panel"
            >
              <LevelLadder
                skillName={skill.name}
                history={skill.history.map((point) => ({ ...point }))}
                ratedPerSide={skill.ratedPerSide}
              />
              <LadderDetails
                history={skill.history.map((point) => ({ ...point }))}
                ratedPerSide={skill.ratedPerSide}
                levelDescriptors={skill.levelDescriptors ?? undefined}
              />
            </div>
          ) : (
            <p className="text-xs text-text-secondary">No ratings yet.</p>
          )}
        </div>
      )}
    </li>
  );
}

// Five horizontal pips, filled 1..count. Count null (DQ / NC / unrated)
// renders all pips empty — the row still shows the shape so the swimmer's
// progression ladder is visible as a visual.
function LevelPips({ count }: { count: 1 | 2 | 3 | 4 | 5 | null }) {
  const pips: Array<1 | 2 | 3 | 4 | 5> = [1, 2, 3, 4, 5];
  return (
    <span
      className="flex gap-[3px] items-center shrink-0"
      aria-hidden="true"
      data-testid="parent-skill-pips"
    >
      {pips.map((pip) => (
        <span
          key={pip}
          className="block h-2 rounded-[2px]"
          style={{
            width: "12px",
            backgroundColor: count !== null && pip <= count ? "var(--color-accent)" : "var(--color-border)",
          }}
        />
      ))}
    </span>
  );
}
