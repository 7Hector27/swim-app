"use client";

interface CategoryRadarProps {
  categories: Array<{ name: string; average: number | null; assessedCount: number }>;
  // Optional "first evaluation" overlay drawn as a dashed polygon
  // beneath the current shape. Same axis order as `categories` — the
  // parent page computes this from the earliest point of score history.
  // Unassessed-at-first axes collapse to the center so the shape stays
  // closed; a null array (default) hides the overlay entirely.
  firstEvaluation?: Array<{ average: number | null; assessedCount: number }>;
  // When the radar renders in a narrow container (coach swimmer profile
  // card), the full "Water confidence" / "Starts and turns" labels
  // collide with the shape. Passing shortLabels swaps every axis label
  // for its short form ("Water" / "Starts") while the SVG's aria-label
  // keeps the full names so screen readers still hear them.
  shortLabels?: boolean;
}

// Short form of each category name used when `shortLabels` is on. Keys
// match the raw catalog names used by the server. Anything not in this
// map falls back to the raw name unchanged.
const SHORT_LABEL: Record<string, string> = {
  "Fundamentals": "Fundamentals",
  "Water confidence": "Water",
  "Freestyle": "Free",
  "Backstroke": "Back",
  "Breaststroke": "Breast",
  "Butterfly": "Fly",
  "Starts and turns": "Starts",
  "IM turns": "IM",
  "Racing": "Racing",
};

// viewBox is wider than tall because side labels (end/start anchored) need
// generous horizontal padding, while top and bottom labels only need enough
// vertical room for two lines of text. Previously 580x400 with the longest
// 15-char line squeezing against the viewBox edge at font 16 (margin
// ~1.5 user units). Widened to 620x420 so a future longer category name
// (up to ~17 chars at desktop font) still clears the edge by double-digit
// units. Shape radius unchanged; the only visual effect is a touch more
// air around the pentagon.
const VB_WIDTH = 620;
const VB_HEIGHT = 420;
const CX = VB_WIDTH / 2;
const CY = VB_HEIGHT / 2;
// Distance from center to the label anchor point. The shape radius sits
// well inside this so dots don't collide with text.
const LABEL_DISTANCE = 150;
const SHAPE_RADIUS = 115;
// Base font-size (viewBox units). Media queries scale this up one step at
// tablet and desktop; see the <style> block below. One-notch-up tier from
// the original 13/14/15: the radar now also renders inside narrow
// sidebar-sized containers (the parent Progress card) where the smaller
// end of that scale read microscopic. The LINE_HEIGHT ratio keeps two-line
// wraps from colliding at any font size. The invariant "label bbox stays
// inside the viewBox" holds comfortably — at desktop font 16 the longest
// two-line label is ~138.5 user units wide vs. ~160 units of label anchor
// room on the horizontal axes (CX - LABEL_DISTANCE = 310 - 150). Verified
// in categoryRadar.test.tsx.
const FONT_SIZE_PHONE = 14;
const FONT_SIZE_TABLET = 15;
const FONT_SIZE_DESKTOP = 16;
const LINE_HEIGHT = 17;

// Split a category name onto two lines on an ampersand ("Breathing &" /
// "Coordination") or on the space nearest the middle when the name is long
// and has no "&". Short names stay on one line.
function splitLabel(name: string): string[] {
  const ampIndex = name.indexOf(" & ");
  if (ampIndex >= 0) {
    return [name.slice(0, ampIndex + 2), name.slice(ampIndex + 3)];
  }
  if (name.length <= 12 || !name.includes(" ")) return [name];
  const mid = name.length / 2;
  let bestSpace = -1;
  let bestDelta = Infinity;
  for (let index = 0; index < name.length; index++) {
    if (name[index] !== " ") continue;
    const delta = Math.abs(index - mid);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestSpace = index;
    }
  }
  if (bestSpace < 0) return [name];
  return [name.slice(0, bestSpace), name.slice(bestSpace + 1)];
}

// Radar snapshot of category averages, 1-5 scale.
// Unassessed categories draw at the center and dim their axis label; the
// polygon still closes so the shape stays coherent.
export default function CategoryRadar({ categories, firstEvaluation, shortLabels = false }: CategoryRadarProps) {
  if (categories.length === 0) return null;
  const step = (Math.PI * 2) / categories.length;

  // Sentence-form text alternative so a screen reader still hears the
  // full category names even when the SVG renders short labels. One
  // comma-separated list of "<Full name>: <avg>" entries.
  const ariaLabel = categories
    .map((category) => `${category.name}: ${category.average !== null ? category.average.toFixed(1) : "not rated yet"}`)
    .join(", ");

  function pointAt(axisIndex: number, value: number): { x: number; y: number } {
    const angle = -Math.PI / 2 + axisIndex * step;
    const scaled = (value / 5) * SHAPE_RADIUS;
    return { x: CX + Math.cos(angle) * scaled, y: CY + Math.sin(angle) * scaled };
  }

  const polygon = categories
    .map((category, index) => {
      const value = category.average ?? 0;
      const pointCoord = pointAt(index, value);
      return `${pointCoord.x.toFixed(1)},${pointCoord.y.toFixed(1)}`;
    })
    .join(" ");

  // Dashed "when she started" overlay. Only draws when the swimmer has
  // more than one evaluation and the overlay's axis list lines up with
  // the categories prop (same length and order). An unassessed-at-first
  // axis collapses to the center, matching how the current shape handles
  // unassessed axes — the dashed shape still closes.
  const firstPolygon =
    firstEvaluation && firstEvaluation.length === categories.length
      ? categories
          .map((_, index) => {
            const entry = firstEvaluation[index];
            const value = entry?.average ?? 0;
            const pointCoord = pointAt(index, value);
            return `${pointCoord.x.toFixed(1)},${pointCoord.y.toFixed(1)}`;
          })
          .join(" ")
      : null;

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${VB_WIDTH} ${VB_HEIGHT}`}
      role="img"
      aria-label={`Category score snapshot. ${ariaLabel}`}
      className="rounded-[var(--radius-card)] block"
      style={{ backgroundColor: "var(--color-surface-soft)" }}
    >
      {/* Web stroke: use placeholder-border in light mode so the rings and
          spokes stay visible against the near-matching surface-soft fill;
          dark mode keeps its original (border) stroke so the shape still
          dominates the composition. Scoped via a class + [data-theme="dark"]
          so we only reach for existing tokens.

          Label text scales up one step per breakpoint. The viewBox is sized
          so even the longest two-line label fits at the desktop step. */}
      <style>{`
        .category-radar-web { stroke: var(--color-placeholder-border); }
        [data-theme="dark"] .category-radar-web { stroke: var(--color-border); }
        .category-radar-label { font-size: ${FONT_SIZE_PHONE}px; }
        @media (min-width: 769px) {
          .category-radar-label { font-size: ${FONT_SIZE_TABLET}px; }
        }
        @media (min-width: 1248px) {
          .category-radar-label { font-size: ${FONT_SIZE_DESKTOP}px; }
        }
      `}</style>

      {[1, 2, 3, 4, 5].map((ring) => (
        <polygon
          key={ring}
          points={categories
            .map((_, index) => {
              const pointCoord = pointAt(index, ring);
              return `${pointCoord.x.toFixed(1)},${pointCoord.y.toFixed(1)}`;
            })
            .join(" ")}
          fill="none"
          className="category-radar-web"
          strokeWidth={0.75}
          opacity={ring === 5 ? 0.95 : 0.55}
        />
      ))}
      {categories.map((_, index) => {
        const outer = pointAt(index, 5);
        return (
          <line
            key={index}
            x1={CX}
            y1={CY}
            x2={outer.x}
            y2={outer.y}
            className="category-radar-web"
            strokeWidth={0.6}
            opacity={0.7}
          />
        );
      })}
      {/* Dashed "when she started" overlay drawn beneath the current
          shape so it reads as context, not as the primary data. Uses
          the text token for the stroke so it stays readable in both
          themes (the token flips light/dark). No fill — the current
          shape is the attention-grabber. */}
      {firstPolygon && (
        <polygon
          points={firstPolygon}
          fill="none"
          stroke="var(--color-text)"
          strokeWidth={1.5}
          strokeDasharray="4 4"
          strokeLinejoin="round"
          data-testid="category-radar-first-evaluation"
        />
      )}
      <polygon
        points={polygon}
        fill="var(--color-accent)"
        fillOpacity={0.22}
        stroke="var(--color-accent)"
        strokeWidth={2}
        strokeLinejoin="round"
      />
      {categories.map((category, index) => {
        const value = category.average ?? 0;
        const pointCoord = pointAt(index, value);
        if (category.assessedCount === 0) return null;
        return (
          <g key={`dot-${index}`}>
            <title>{`${category.name}: ${category.average !== null ? category.average.toFixed(1) : "—"}`}</title>
            <circle
              cx={pointCoord.x}
              cy={pointCoord.y}
              r={3.5}
              fill="var(--color-accent)"
              stroke="var(--color-surface-soft)"
              strokeWidth={1.5}
            />
          </g>
        );
      })}
      {categories.map((category, index) => {
        const angle = -Math.PI / 2 + index * step;
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        const labelX = CX + cosA * LABEL_DISTANCE;
        const labelY = CY + sinA * LABEL_DISTANCE;
        // cos drives horizontal anchoring; the ±0.3 band around the vertical
        // axis gets middle-anchored so top-of-chart and bottom-of-chart
        // labels sit over their spoke rather than drifting sideways.
        const textAnchor: "start" | "middle" | "end" =
          cosA > 0.3 ? "start" : cosA < -0.3 ? "end" : "middle";
        const fullName = category.name;
        const shortName = SHORT_LABEL[category.name] ?? category.name;
        const fullLines = splitLabel(fullName);
        const shortLines = splitLabel(shortName);
        // Vertical placement: lines are stacked around labelY. Top-of-chart
        // labels (sinA negative) sit above the point so the baseline doesn't
        // overlap the shape; bottom labels sit below; sides are centered.
        function topBiasFor(lineCount: number): number {
          return sinA < -0.5 ? -(lineCount - 1) * LINE_HEIGHT : sinA > 0.5 ? LINE_HEIGHT : -((lineCount - 1) / 2) * LINE_HEIGHT;
        }
        const fill = category.assessedCount === 0 ? "var(--color-text-secondary)" : "var(--color-text)";
        const opacity = category.assessedCount === 0 ? 0.65 : 1;

        // Label rendering has three modes:
        //   - `shortLabels` static: only short lines render.
        //   - `shortLabelsOnDesktop`: both variants render; CSS inside
        //     the `<style>` block above hides the non-active one at
        //     the desktop breakpoint.
        //   - default: full lines only.
        if (shortLabels) {
          const baseY = labelY + topBiasFor(shortLines.length);
          return (
            <text
              key={`label-${index}`}
              x={labelX}
              y={baseY}
              textAnchor={textAnchor}
              fontWeight={500}
              fill={fill}
              opacity={opacity}
              className="category-radar-label"
              data-testid="category-radar-label"
            >
              {shortLines.map((line, lineIndex) => (
                <tspan key={lineIndex} x={labelX} dy={lineIndex === 0 ? 0 : LINE_HEIGHT}>
                  {line}
                </tspan>
              ))}
            </text>
          );
        }
        const baseY = labelY + topBiasFor(fullLines.length);
        return (
          <text
            key={`label-${index}`}
            x={labelX}
            y={baseY}
            textAnchor={textAnchor}
            fontWeight={500}
            fill={fill}
            opacity={opacity}
            className="category-radar-label"
            data-testid="category-radar-label"
          >
            {fullLines.map((line, lineIndex) => (
              <tspan key={lineIndex} x={labelX} dy={lineIndex === 0 ? 0 : LINE_HEIGHT}>
                {line}
              </tspan>
            ))}
          </text>
        );
      })}
    </svg>
  );
}
