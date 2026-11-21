import type { ReactNode } from "react";
import {
  buildChips,
  buildLadderSeries,
  buildNextDescriptor,
  trimToRecent,
  type LadderPoint,
} from "./helpers";

interface LadderDetailsProps {
  history: LadderPoint[];
  ratedPerSide: boolean;
  // Parent API ships per-skill level descriptors; coach API does not.
  // When undefined / empty the "Next, <level>:" line is skipped.
  levelDescriptors?: Record<string, string> | undefined;
  // Coach-only extras (edit list, fault tags) that render under the
  // legend. Parents never pass this.
  extras?: ReactNode;
}

// Right column of an opened skill row:
//
//   1. Chips row — "Now: <level>" plus the change chip.
//   2. "Next, <levelName>:" descriptor line in plain 13px text.
//   3. One-line shape legend describing the context markers.
//   4. Optional coach-only extras (edit list + fault tags).
//
// Rendered as plain HTML (no SVG), so text sizing stays stable at every
// viewport.
export default function LadderDetails({
  history,
  ratedPerSide,
  levelDescriptors,
  extras,
}: LadderDetailsProps) {
  const descriptors: Partial<Record<1 | 2 | 3 | 4 | 5, string>> | undefined = levelDescriptors
    ? ({
        1: levelDescriptors["1"],
        2: levelDescriptors["2"],
        3: levelDescriptors["3"],
        4: levelDescriptors["4"],
        5: levelDescriptors["5"],
      } as Partial<Record<1 | 2 | 3 | 4 | 5, string>>)
    : undefined;

  const groups = ratedPerSide
    ? [
        { key: "left" as const, label: "L", series: trimToRecent(buildLadderSeries(history, "left")) },
        { key: "right" as const, label: "R", series: trimToRecent(buildLadderSeries(history, "right")) },
      ]
    : [{ key: "single" as const, label: null, series: trimToRecent(buildLadderSeries(history, null)) }];

  const anyGroupHasPoints = groups.some((group) => group.series.length > 0);
  if (!anyGroupHasPoints) return null;

  return (
    <div className="flex flex-col gap-3" data-testid="ladder-details">
      {groups.map((group) => {
        if (group.series.length === 0) return null;
        const chips = buildChips(group.series);
        const next = buildNextDescriptor(group.series, descriptors);
        if (chips.length === 0 && !next) return null;
        return (
          <div key={group.key} className="flex flex-col gap-2">
            {chips.length > 0 && (
              <div className="flex flex-wrap gap-2 items-center" data-testid={`ladder-details-chips-${group.key}`}>
                {group.label && (
                  <span className="text-xs font-semibold text-text-secondary">{group.label}:</span>
                )}
                {chips.map((chip) => (
                  <span
                    key={`${group.key}-${chip.key}`}
                    className="text-xs px-2 py-0.5 rounded-md"
                    style={{
                      backgroundColor:
                        chip.tone === "accent"
                          ? "var(--color-accent)"
                          : chip.tone === "muted"
                            ? "var(--color-surface-soft)"
                            : "var(--color-border)",
                      color:
                        chip.tone === "accent"
                          ? "var(--color-on-accent)"
                          : chip.tone === "muted"
                            ? "var(--color-text-secondary)"
                            : "var(--color-text)",
                    }}
                    data-testid={`level-ladder-chip-${chip.key}`}
                  >
                    {chip.label}
                  </span>
                ))}
              </div>
            )}
            {next && (
              <p
                className="text-text"
                style={{ fontSize: "13px", lineHeight: "1.4" }}
                data-testid={`ladder-details-next-${group.key}`}
              >
                <span className="font-semibold">Next, {next.levelName}:</span> {next.text}
              </p>
            )}
          </div>
        );
      })}
      <p
        className="text-xs text-text-secondary"
        data-testid="ladder-details-legend"
      >
        Circle is practice, triangle is a drill, diamond is a race.
        {ratedPerSide && " Solid line is left side, dashed is right."}
      </p>
      {extras}
    </div>
  );
}
