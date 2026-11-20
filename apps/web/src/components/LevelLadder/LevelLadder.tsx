"use client";

import { stepLinePath } from "@/lib/stepChart";
import {
  BAND_ORDER,
  buildLadderSeries,
  buildSrDescription,
  formatLadderDate,
  ladderEffectiveLevel,
  LEVEL_NAMES,
  pickDateTickIndices,
  trimToRecent,
  type LadderPoint,
} from "./helpers";

// Context shape. Non-newest points draw as their context shape; the
// newest point draws as a filled circle with the grade number inside
// (per the rebuilt brief) regardless of context.
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
}

// Fixed drawing size — 400 × 160 CSS px at the maximum. The SVG sets a
// 1:1 viewBox so every length in the SVG lands at CSS-pixel scale when
// the component renders at its ceiling. In a narrower column the SVG
// scales down proportionally; all visible text is sized in CSS px via
// inline `style`, so SVG scale does not change the rendered font size
// (CSS px inside SVG are absolute, not viewBox units).
const VIEW_WIDTH = 400;
const VIEW_HEIGHT = 160;
// Left gutter wide enough for the longest "N <levelName>" label at 12px
// with 6px of right padding before the bar. "2 Developing" (12 chars) at
// ≈7px per char = 84px; 96 leaves breathing room. Same gutter for every
// label since the band labels are drawn at textAnchor="end" at the
// gutter's right edge.
const PAD_LEFT = 96;
const LABEL_RIGHT_PAD = 6;
const PAD_RIGHT = 16;
const PAD_TOP = 4;
const BAND_HEIGHT = 24;
const BANDS_TOTAL_HEIGHT = BAND_HEIGHT * 5;
const SPECIAL_ROW_HEIGHT = 16;
const PLOT_WIDTH = VIEW_WIDTH - PAD_LEFT - PAD_RIGHT;
const DATE_Y = PAD_TOP + BANDS_TOTAL_HEIGHT + SPECIAL_ROW_HEIGHT + 12;
// Font sizes in CSS px — not viewBox units.
const TEXT_FONT_SIZE = 12;
const SPECIAL_FONT_SIZE = 10;
// Non-newest shape marker size in viewBox units.
const MARKER_SIZE = 4;
// Newest-point filled circle: r=10 so a 12-CSS-px digit sits comfortably.
const NEWEST_RADIUS = 10;

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
// one. A single point sits at the RIGHT edge of the plot so its date label
// doesn't float in the middle of the chart.
function xForIndex(index: number, count: number): number {
  if (count <= 1) return PAD_LEFT + PLOT_WIDTH;
  return PAD_LEFT + (index / (count - 1)) * PLOT_WIDTH;
}

// Shape path for the small (non-newest) markers.
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
  // Circle is rendered via <circle>, not a path.
  return "";
}

// One Series per drawn step line (one for unsided skills, two for sided).
interface Series {
  key: "single" | "left" | "right";
  points: LadderPoint[];
  dashed: boolean;
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

// Chart-only level ladder. Chips, Next-level descriptor, and the context
// shape legend live in LadderDetails on the right side of the opened
// skill row — this component renders only the bands + step lines +
// markers + date labels.
export default function LevelLadder({ skillName, history, ratedPerSide }: LevelLadderProps) {
  const series: Series[] = ratedPerSide
    ? [
        {
          key: "left",
          points: trimToRecent(buildLadderSeries(history, "left")),
          dashed: false,
        },
        {
          key: "right",
          points: trimToRecent(buildLadderSeries(history, "right")),
          dashed: true,
        },
      ]
    : [
        {
          key: "single",
          points: trimToRecent(buildLadderSeries(history, null)),
          dashed: false,
        },
      ];

  // The highlighted band is driven by the newest graded point across all
  // drawn series. When both sides exist we pick whichever has the most
  // recent rating.
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

  const srDescription = ratedPerSide
    ? series
        .filter((stream) => stream.points.length > 0)
        .map((stream) => `${stream.key === "left" ? "Left" : "Right"}: ${buildSrDescription(skillName, stream.points)}`)
        .join(" ")
    : buildSrDescription(skillName, series[0]?.points ?? []);

  const hasAnyPoints = series.some((stream) => stream.points.length > 0);
  if (!hasAnyPoints) {
    return <p className="text-xs text-text-secondary py-2">No ratings yet.</p>;
  }

  return (
    <svg
      viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      role="img"
      aria-label={`${skillName} level ladder`}
      className="block"
      style={{ maxWidth: `${VIEW_WIDTH}px`, width: "100%", height: "auto" }}
      data-testid="level-ladder"
    >
      <title>{`${skillName} level ladder`}</title>
      <desc>{srDescription}</desc>

      {/* Bands + their labels. Current band gets a tinted fill and its
          label switches to accent. Non-current band fills alternate
          between surface-soft and background so the stack reads. */}
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
              x={PAD_LEFT - LABEL_RIGHT_PAD}
              y={topY + BAND_HEIGHT / 2 + 4}
              textAnchor="end"
              style={{
                fontSize: `${TEXT_FONT_SIZE}px`,
                fontWeight: isCurrent ? 600 : 400,
                fill: isCurrent ? "var(--color-accent)" : "var(--color-text-secondary)",
              }}
              data-testid="level-ladder-band-label"
              data-level={level}
            >
              {level} {LEVEL_NAMES[level]}
            </text>
          </g>
        );
      })}

      {/* Step lines + markers per series. Each stream is its own group
          so the dashed right-side line doesn't affect the solid left. */}
      {series.map((stream) => {
        if (stream.points.length === 0) return null;
        const count = stream.points.length;
        const newestIdx = newestGradedIndex(stream.points);

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

            {stream.points.map((point, index) => {
              const level = pointLatestLevel(point);
              if (level === null) return null;
              const cx = xForIndex(index, count);
              const cy = centreYForLevel(level);
              const isNewest = index === newestIdx;
              const title = `${formatLadderDate(point.sessionDate)} · ${point.context} · ${LEVEL_NAMES[level]}`;

              if (isNewest) {
                // Always a filled circle with the grade number inside,
                // regardless of context shape, per the brief.
                return (
                  <g key={point.id} data-testid="level-ladder-newest">
                    <circle
                      cx={cx}
                      cy={cy}
                      r={NEWEST_RADIUS}
                      fill="var(--color-accent)"
                      stroke="var(--color-surface-soft)"
                      strokeWidth={1.5}
                    >
                      <title>{title}</title>
                    </circle>
                    <text
                      x={cx}
                      y={cy + 4}
                      textAnchor="middle"
                      style={{
                        fontSize: `${TEXT_FONT_SIZE}px`,
                        fontWeight: 700,
                        fill: "var(--color-on-accent)",
                      }}
                      aria-hidden="true"
                    >
                      {level}
                    </text>
                  </g>
                );
              }

              const shape = CONTEXT_SHAPE[point.context] ?? "circle";
              if (shape === "circle") {
                return (
                  <g key={point.id} data-testid="level-ladder-point">
                    <circle
                      cx={cx}
                      cy={cy}
                      r={MARKER_SIZE}
                      fill="var(--color-accent)"
                      stroke="var(--color-surface-soft)"
                      strokeWidth={1}
                    >
                      <title>{title}</title>
                    </circle>
                  </g>
                );
              }
              return (
                <g key={point.id} data-testid="level-ladder-point">
                  <path
                    d={shapePath(shape, cx, cy, MARKER_SIZE)}
                    fill="var(--color-accent)"
                    stroke="var(--color-surface-soft)"
                    strokeWidth={1}
                  >
                    <title>{title}</title>
                  </path>
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
                    style={{
                      fontSize: `${SPECIAL_FONT_SIZE}px`,
                      fontWeight: 700,
                      fill: point.notLegal ? "var(--color-on-danger)" : "var(--color-text)",
                    }}
                  >
                    <title>{title}</title>
                    {label}
                  </text>
                </g>
              );
            })}

            {/* Date labels. First and last anchor to their plot edges so
                neither clips at the sides; middle ticks (up to two) stay
                centred. The sided variant only emits dates from the left
                series so the same slot isn't labelled twice. */}
            {(() => {
              const tickSet = pickDateTickIndices(count);
              return stream.points.map((point, index) => {
                if (!tickSet.has(index)) return null;
                if (ratedPerSide && stream.key !== "left") return null;
                const cx = xForIndex(index, count);
                const anchor: "start" | "middle" | "end" =
                  index === 0 && count > 1
                    ? "start"
                    : index === count - 1
                      ? "end"
                      : "middle";
                return (
                  <text
                    key={`date-${point.id}`}
                    x={cx}
                    y={DATE_Y}
                    textAnchor={anchor}
                    style={{ fontSize: `${TEXT_FONT_SIZE}px`, fill: "var(--color-text-secondary)" }}
                    data-testid="level-ladder-date-label"
                    data-anchor={anchor}
                    data-first-or-last={index === 0 || index === count - 1 ? "true" : undefined}
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
  );
}

// Exposed so callers that render their own "panel" container can set the
// gutter width consistently (e.g. in the matching details column).
export { PAD_LEFT as LADDER_LABEL_GUTTER, LABEL_RIGHT_PAD as LADDER_LABEL_RIGHT_PAD, VIEW_WIDTH as LADDER_VIEW_WIDTH, VIEW_HEIGHT as LADDER_VIEW_HEIGHT };
