"use client";

import { stepLinePath } from "@/lib/stepChart";
import {
  BAND_ORDER,
  buildChips,
  buildLadderSeries,
  buildSrDescription,
  formatLadderDate,
  ladderEffectiveLevel,
  LEVEL_NAMES,
  pickDateTickIndices,
  trimToRecent,
  type ChipData,
  type LadderPoint,
} from "./helpers";

// Context shape — same vocabulary as the retired SkillChart. Pulled out as
// a constant so later ladder-flavored charts can reuse the mapping without
// redefining it.
type ContextShape = "circle" | "triangle" | "diamond";
const CONTEXT_SHAPE: Record<string, ContextShape> = {
  drill: "triangle",
  practice: "circle",
  race: "diamond",
};

interface LevelLadderProps {
  skillName: string;
  history: LadderPoint[];
  ratedPerSide: boolean;
  // Optional per-skill level descriptors (parent API ships them under
  // ParentSkillProgress.levelDescriptors; coach API doesn't carry them).
  // Shape is { "1": "...", "2": "...", … } — keys are string digits.
  levelDescriptors?: Record<string, string> | undefined;
}

// SVG virtual coordinate system. Width is set via width="100%" so the chart
// scales to the row's content area; the viewBox below defines the
// internal units. 320 wide works at 375px phone width (page padding + the
// expanded-row inset leave ~280px of real render width, comfortable at the
// viewBox's 320-unit space).
const VIEW_WIDTH = 320;
const PAD_LEFT = 68;
const PAD_RIGHT = 12;
const PAD_TOP = 4;
const BAND_HEIGHT = 24;
const BANDS_TOTAL_HEIGHT = BAND_HEIGHT * 5;
const SPECIAL_ROW_HEIGHT = 18;
const DATE_ROW_HEIGHT = 32;
const PAD_BOTTOM = 4;
const VIEW_HEIGHT = PAD_TOP + BANDS_TOTAL_HEIGHT + SPECIAL_ROW_HEIGHT + DATE_ROW_HEIGHT + PAD_BOTTOM;
const PLOT_WIDTH = VIEW_WIDTH - PAD_LEFT - PAD_RIGHT;

// Vertical centre of a given band, in SVG units. Bands stack top-to-bottom
// in BAND_ORDER (5 at the top), so level 5 → band index 0 → the uppermost
// centre.
function centreYForLevel(level: 1 | 2 | 3 | 4 | 5): number {
  const bandIndex = BAND_ORDER.indexOf(level);
  return PAD_TOP + bandIndex * BAND_HEIGHT + BAND_HEIGHT / 2;
}

// x-coordinate for a point at `index` in a series of length `count`. Uses
// even spacing across the plot (one slot per rating), not real-day spacing:
// the ladder is a cadence-of-measurements narrative, not an elapsed-time
// one. When count === 1 the single point sits in the plot centre.
function xForIndex(index: number, count: number): number {
  if (count <= 1) return PAD_LEFT + PLOT_WIDTH / 2;
  return PAD_LEFT + (index / (count - 1)) * PLOT_WIDTH;
}

// Shape path for the small (and large newest) markers.
function shapePath(shape: ContextShape, cx: number, cy: number, size: number): string {
  if (shape === "triangle") {
    const top = cy - size;
    const baseY = cy + size * 0.7;
    const baseHalf = size * 1.05;
    return `M${cx},${top} L${cx - baseHalf},${baseY} L${cx + baseHalf},${baseY} Z`;
  }
  if (shape === "diamond") {
    return `M${cx},${cy - size} L${cx + size},${cy} L${cx},${cy + size} L${cx - size},${cy} Z`;
  }
  // Circle rendered via <circle> rather than a path. We return an empty
  // string so callers know to use the <circle> element branch.
  return "";
}

// One Series per drawn step line (one for unsided skills, two for sided).
interface Series {
  key: "single" | "left" | "right";
  points: LadderPoint[];     // trimmed, oldest-first
  dashed: boolean;            // right side dashed; left + single solid
  label: string | null;       // "L" / "R" when sided, null otherwise
}

function pointLatestLevel(point: LadderPoint): 1 | 2 | 3 | 4 | 5 | null {
  return ladderEffectiveLevel(point);
}

// Finds the newest graded point in a series; used for the enlarged, numbered
// marker. Returns null when every point in the series is NL/NC.
function newestGradedIndex(series: LadderPoint[]): number | null {
  for (let index = series.length - 1; index >= 0; index -= 1) {
    const point = series[index];
    if (!point) continue;
    if (pointLatestLevel(point) !== null) return index;
  }
  return null;
}

export default function LevelLadder({ skillName, history, ratedPerSide, levelDescriptors }: LevelLadderProps) {
  const descriptors: Partial<Record<1 | 2 | 3 | 4 | 5, string>> | undefined = levelDescriptors
    ? ({
        1: levelDescriptors["1"],
        2: levelDescriptors["2"],
        3: levelDescriptors["3"],
        4: levelDescriptors["4"],
        5: levelDescriptors["5"],
      } as Partial<Record<1 | 2 | 3 | 4 | 5, string>>)
    : undefined;

  const series: Series[] = ratedPerSide
    ? [
        {
          key: "left",
          points: trimToRecent(buildLadderSeries(history, "left")),
          dashed: false,
          label: "L",
        },
        {
          key: "right",
          points: trimToRecent(buildLadderSeries(history, "right")),
          dashed: true,
          label: "R",
        },
      ]
    : [
        {
          key: "single",
          points: trimToRecent(buildLadderSeries(history, null)),
          dashed: false,
          label: null,
        },
      ];

  // The highlighted band is driven by the newest graded point across all
  // drawn series — the single chip set and the band highlight should agree.
  // When both sides exist we pick whichever has the most recent rating.
  let highlightLevel: 1 | 2 | 3 | 4 | 5 | null = null;
  let latestDateMillis = -Infinity;
  for (const stream of series) {
    for (let index = stream.points.length - 1; index >= 0; index -= 1) {
      const point = stream.points[index];
      if (!point) continue;
      const level = pointLatestLevel(point);
      if (level === null) continue;
      const stamp = Date.parse(`${point.sessionDate}T12:00:00Z`);
      if (stamp > latestDateMillis) {
        latestDateMillis = stamp;
        highlightLevel = level;
      }
      break;
    }
  }

  // Chip set: non-sided → one set from the whole series. Sided → one set per
  // side, each prefixed with "L: " / "R: " so the chips stay unambiguous.
  const chipGroups: Array<{ key: string; label: string | null; chips: ChipData[] }> = ratedPerSide
    ? series.map((stream) => ({
        key: stream.key,
        label: stream.label,
        chips: buildChips(stream.points, descriptors),
      }))
    : [{ key: "single", label: null, chips: buildChips(series[0]?.points ?? [], descriptors) }];

  // sr-only: a single flat sentence. When sided, prefix per side.
  const srDescription = ratedPerSide
    ? series
        .filter((stream) => stream.points.length > 0)
        .map((stream) => `${stream.label === "L" ? "Left" : "Right"}: ${buildSrDescription(skillName, stream.points)}`)
        .join(" ")
    : buildSrDescription(skillName, series[0]?.points ?? []);

  const hasAnyPoints = series.some((stream) => stream.points.length > 0);

  if (!hasAnyPoints) {
    return <p className="text-xs text-text-secondary py-2">No ratings yet.</p>;
  }

  return (
    <div className="flex flex-col gap-3" data-testid="level-ladder">
      {/* Legend: context shapes always; sides only when the skill is sided. */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-text-secondary">
        <span aria-label="Practice (circle)">● Practice</span>
        <span aria-label="Drill (triangle)">▲ Drill</span>
        <span aria-label="Race (diamond)">◆ Race</span>
        {ratedPerSide && (
          <>
            <span className="mx-1" aria-hidden="true">·</span>
            <span aria-label="Left side, solid line">— L</span>
            <span aria-label="Right side, dashed line">╌ R</span>
          </>
        )}
      </div>

      <svg
        width="100%"
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        role="img"
        aria-label={`${skillName} level ladder`}
        className="rounded"
        style={{ backgroundColor: "var(--color-surface-soft)" }}
      >
        <title>{`${skillName} level ladder`}</title>
        <desc>{srDescription}</desc>

        {/* Bands + their labels. Current band gets a tinted fill and the
            label switches to accent. Non-current band labels stay in
            text-secondary and the fill alternates between surface-soft and
            background so the bands read as a stack. */}
        {BAND_ORDER.map((level, bandIndex) => {
          const topY = PAD_TOP + bandIndex * BAND_HEIGHT;
          const isCurrent = level === highlightLevel;
          return (
            <g key={level}>
              <rect
                x={PAD_LEFT}
                y={topY}
                width={PLOT_WIDTH}
                height={BAND_HEIGHT}
                fill={isCurrent ? "var(--color-accent)" : "var(--color-background)"}
                fillOpacity={isCurrent ? 0.12 : 1}
                stroke="var(--color-border)"
                strokeWidth={0.5}
              />
              <text
                x={PAD_LEFT - 6}
                y={topY + BAND_HEIGHT / 2 + 3}
                textAnchor="end"
                fontSize={10}
                fontWeight={isCurrent ? 600 : 400}
                fill={isCurrent ? "var(--color-accent)" : "var(--color-text-secondary)"}
              >
                {level} {LEVEL_NAMES[level]}
              </text>
            </g>
          );
        })}

        {/* Step lines + markers per series. Each stream is drawn in its own
            group so stroke-dasharray can toggle per series without touching
            the other. */}
        {series.map((stream) => {
          if (stream.points.length === 0) return null;
          const count = stream.points.length;
          const newestIdx = newestGradedIndex(stream.points);

          // Step-line coordinates. Only graded points contribute — NL/NC are
          // excluded from the line (and drawn separately in the special
          // row).
          const linePoints: Array<{ x: number; y: number }> = [];
          stream.points.forEach((point, index) => {
            const level = pointLatestLevel(point);
            if (level === null) return;
            linePoints.push({ x: xForIndex(index, count), y: centreYForLevel(level) });
          });
          const linePath = stepLinePath(linePoints);

          return (
            <g key={stream.key} data-series={stream.key}>
              {linePath && (
                <path
                  d={linePath}
                  fill="none"
                  stroke="var(--color-accent)"
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray={stream.dashed ? "4 3" : undefined}
                  data-testid={`level-ladder-line-${stream.key}`}
                />
              )}

              {/* Points. Graded → shape marker; NL/NC → skipped here, they
                  render in the special row below the bands. */}
              {stream.points.map((point, index) => {
                const level = pointLatestLevel(point);
                if (level === null) return null;
                const cx = xForIndex(index, count);
                const cy = centreYForLevel(level);
                const shape = CONTEXT_SHAPE[point.context] ?? "circle";
                const isNewest = index === newestIdx;
                const size = isNewest ? 8 : 4;
                const title = `${formatLadderDate(point.sessionDate)} · ${point.context} · ${LEVEL_NAMES[level]}`;

                if (shape === "circle") {
                  return (
                    <g key={point.id} data-testid={isNewest ? "level-ladder-newest" : "level-ladder-point"}>
                      <circle
                        cx={cx}
                        cy={cy}
                        r={size}
                        fill="var(--color-accent)"
                        stroke="var(--color-surface-soft)"
                        strokeWidth={isNewest ? 1.5 : 1}
                      >
                        <title>{title}</title>
                      </circle>
                      {isNewest && (
                        <text
                          x={cx}
                          y={cy + 3}
                          textAnchor="middle"
                          fontSize={9}
                          fontWeight={700}
                          fill="var(--color-on-accent)"
                          aria-hidden="true"
                        >
                          {level}
                        </text>
                      )}
                    </g>
                  );
                }
                return (
                  <g key={point.id} data-testid={isNewest ? "level-ladder-newest" : "level-ladder-point"}>
                    <path
                      d={shapePath(shape, cx, cy, size)}
                      fill="var(--color-accent)"
                      stroke="var(--color-surface-soft)"
                      strokeWidth={isNewest ? 1.5 : 1}
                    >
                      <title>{title}</title>
                    </path>
                    {isNewest && (
                      <text
                        x={cx}
                        y={cy + 3}
                        textAnchor="middle"
                        fontSize={9}
                        fontWeight={700}
                        fill="var(--color-on-accent)"
                        aria-hidden="true"
                      >
                        {level}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* Not legal / No concept markers. Below the bands in their
                  own row, styled distinctly so they don't read as a 0-level. */}
              {stream.points.map((point, index) => {
                if (!point.notLegal && !point.noConcept) return null;
                const cx = xForIndex(index, count);
                const cy = PAD_TOP + BANDS_TOTAL_HEIGHT + SPECIAL_ROW_HEIGHT / 2;
                const label = point.notLegal ? "NL" : "NC";
                const title = `${formatLadderDate(point.sessionDate)} · ${point.context} · ${point.notLegal ? "Not legal" : "No concept"}`;
                return (
                  <g key={`special-${point.id}`} data-testid="level-ladder-special">
                    <rect
                      x={cx - 9}
                      y={cy - 7}
                      width={18}
                      height={14}
                      rx={3}
                      fill={point.notLegal ? "var(--color-danger)" : "var(--color-border)"}
                    />
                    <text
                      x={cx}
                      y={cy + 3}
                      textAnchor="middle"
                      fontSize={8}
                      fontWeight={700}
                      fill={point.notLegal ? "var(--color-on-danger)" : "var(--color-text)"}
                    >
                      <title>{title}</title>
                      {label}
                    </text>
                  </g>
                );
              })}

              {/* Date labels. Picks a sparse set so at 10 points they don't
                  collide. Always includes first + last. */}
              {(() => {
                const tickSet = pickDateTickIndices(count);
                return stream.points.map((point, index) => {
                  if (!tickSet.has(index)) return null;
                  // When sided, only the first series draws date labels so
                  // the x-axis isn't repeated. The two sides share the same
                  // index→x mapping (both trimmed to the recent 10), so one
                  // row of labels covers both.
                  if (ratedPerSide && stream.key !== "left") return null;
                  const cx = xForIndex(index, count);
                  const cy = PAD_TOP + BANDS_TOTAL_HEIGHT + SPECIAL_ROW_HEIGHT + 12;
                  return (
                    <text
                      key={`date-${point.id}`}
                      x={cx}
                      y={cy}
                      textAnchor="middle"
                      fontSize={8}
                      fill="var(--color-text-secondary)"
                    >
                      {formatLadderDate(point.sessionDate)}
                    </text>
                  );
                });
              })()}
            </g>
          );
        })}
      </svg>

      {/* Chips. Flex-wraps naturally at phone width. */}
      <div className="flex flex-col gap-2" data-testid="level-ladder-chips">
        {chipGroups.map((group) => {
          if (group.chips.length === 0) return null;
          return (
            <div key={group.key} className="flex flex-wrap gap-2 items-center">
              {group.label && (
                <span className="text-xs font-semibold text-text-secondary">{group.label}:</span>
              )}
              {group.chips.map((chip) => (
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
          );
        })}
      </div>
    </div>
  );
}
