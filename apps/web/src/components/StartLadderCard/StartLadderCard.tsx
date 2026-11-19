"use client";

import type { StartComponentProgress, StartGradeResult } from "@swim-app/shared";
import LevelLadder from "@/components/LevelLadder";
import {
  componentBarFill,
  componentCounts,
  componentValueLabel,
  pickBranch,
  startHistoryToLadderPoints,
  statusBadge,
  type StatusBadgeData,
} from "./helpers";

interface StartLadderCardProps {
  name: string;
  grade: StartGradeResult;
  components: StartComponentProgress[];
  // Oldest-first history of this start's calculated grade, pulled from
  // scoreHistory. Empty when the swimmer has no sessions yet or has rated
  // no components of this start — the card falls back to the one-liner.
  history: Array<{ sessionDate: string; grade: StartGradeResult; sessionId?: string }>;
}

export default function StartLadderCard({ name, grade, components, history }: StartLadderCardProps) {
  const branch = pickBranch(grade, components);
  const badge = statusBadge(grade);
  const { graded, total } = componentCounts(components);

  return (
    <div
      className="flex flex-col gap-3 p-4 rounded border"
      style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-surface-soft)" }}
      data-testid={`start-ladder-card-${branch}`}
    >
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-text flex-1 truncate">{name}</h3>
        <StatusChip badge={badge} />
      </div>

      {branch === "notStarted" && (
        <p className="text-xs text-text-secondary">Not started yet</p>
      )}

      {branch === "noConcept" && (
        <p className="text-xs text-text-secondary">
          Swimmer hasn't shown the basic idea of this start yet.
        </p>
      )}

      {branch === "inProgress" && (
        <>
          <p className="text-xs text-text-secondary">
            {graded} of {total} components graded
          </p>
          <ComponentList components={components} />
        </>
      )}

      {branch === "graded" && (
        <>
          {history.length > 0 && (
            <LevelLadder
              skillName={name}
              history={startHistoryToLadderPoints(history)}
              ratedPerSide={false}
            />
          )}
          <ComponentList components={components} />
        </>
      )}
    </div>
  );
}

function StatusChip({ badge }: { badge: StatusBadgeData }) {
  const palette: Record<StatusBadgeData["tone"], { bg: string; color: string }> = {
    accent: { bg: "var(--color-accent)", color: "var(--color-on-accent)" },
    danger: { bg: "var(--color-danger)", color: "var(--color-on-danger)" },
    muted: { bg: "var(--color-surface-soft)", color: "var(--color-text-secondary)" },
    neutral: { bg: "var(--color-border)", color: "var(--color-text)" },
  };
  const style = palette[badge.tone];
  return (
    <span
      className="text-xs font-semibold px-2 py-0.5 rounded-md whitespace-nowrap"
      style={{ backgroundColor: style.bg, color: style.color }}
      data-testid="start-ladder-status-badge"
    >
      {badge.label}
    </span>
  );
}

function ComponentList({ components }: { components: StartComponentProgress[] }) {
  if (components.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1.5" data-testid="start-ladder-components">
      {components.map((component) => (
        <ComponentRow key={component.slug} component={component} />
      ))}
    </ul>
  );
}

function ComponentRow({ component }: { component: StartComponentProgress }) {
  const fill = componentBarFill(component.current);
  const valueLabel = componentValueLabel(component.current);
  const isDq = component.current?.notLegal === true;
  const isNc = component.current?.noConcept === true;

  return (
    <li className="flex items-center gap-2 text-xs min-w-0">
      <span className="text-text-secondary flex-1 min-w-0 truncate">{component.name}</span>
      {isDq ? (
        <span
          className="font-semibold px-1.5 py-0.5 rounded-md"
          style={{ backgroundColor: "var(--color-danger)", color: "var(--color-on-danger)" }}
        >
          DQ
        </span>
      ) : isNc ? (
        <span
          className="font-semibold px-1.5 py-0.5 rounded-md"
          style={{ backgroundColor: "var(--color-surface-soft)", color: "var(--color-text-secondary)" }}
        >
          NC
        </span>
      ) : fill === null ? (
        <span className="text-text-secondary">Not yet</span>
      ) : (
        <>
          {valueLabel && (
            <span className="text-text tabular-nums">{valueLabel}</span>
          )}
          <LevelBar fill={fill} />
        </>
      )}
    </li>
  );
}

// 5 small blocks, filled left-to-right to the component's grade. Each block
// is 10px wide with a 2px gap so the strip stays narrow at phone width.
// Filled blocks use the accent color; unfilled blocks use the border color
// so the shape stays visible against the surface-soft card background.
function LevelBar({ fill }: { fill: number }) {
  const blocks: Array<1 | 2 | 3 | 4 | 5> = [1, 2, 3, 4, 5];
  return (
    <span
      className="inline-flex gap-[2px] shrink-0"
      aria-label={`Level ${fill} of 5`}
      data-testid="start-ladder-component-bar"
    >
      {blocks.map((block) => (
        <span
          key={block}
          className="block h-2 w-[10px] rounded-[1px]"
          style={{
            backgroundColor:
              block <= fill ? "var(--color-accent)" : "var(--color-border)",
          }}
          aria-hidden="true"
        />
      ))}
    </span>
  );
}
