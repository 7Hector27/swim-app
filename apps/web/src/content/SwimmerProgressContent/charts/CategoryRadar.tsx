"use client";

interface CategoryRadarProps {
  categories: Array<{ name: string; average: number | null; assessedCount: number }>;
  // Optional "first evaluation" overlay drawn as a dashed polygon
  // beneath the current shape. Same axis order as `categories` — the
  // parent page computes this from the earliest point of score history.
  // Unassessed-at-first axes collapse to the center so the shape stays
  // closed; a null array (default) hides the overlay entirely.
  firstEvaluation?: Array<{ average: number | null; assessedCount: number }>;
}

// Geometry. The viewBox is sized so a 15-char line at the desktop font
// (16 user units) plus a 10-unit gap outside the outer ring fits on
// every axis — including the 70°/110° bottom pair whose centers sit at
// the same y and so need horizontal separation of at least the label
// width to avoid touching.
const VB_WIDTH = 600;
const VB_HEIGHT = 480;
const CX = VB_WIDTH / 2;
const CY = VB_HEIGHT / 2;
const SHAPE_RADIUS = 115;

// Label placement. Every label's visual block is centered on its axis
// at `LABEL_DISTANCE` from the chart origin. That single distance has to
// satisfy two separate constraints:
//
//   1. The block's nearest edge must clear the outer ring. The worst
//      case is a label on a near-horizontal axis, where the block's
//      inner edge sits at LABEL_DISTANCE - LABEL_MAX_WIDTH / 2 along
//      the axis. We need that ≥ SHAPE_RADIUS + LABEL_CLEAR_GAP, so
//      LABEL_DISTANCE ≥ 115 + 10 + 70 = 195.
//
//   2. Adjacent labels must not overlap. For the 9-category radar the
//      tightest pair is at angles 70° and 110° — identical sin, so the
//      only separation between centers is horizontal: 2 · cos(70°) · D
//      = 0.684 · D. For non-overlapping boxes we need 0.684 · D >
//      LABEL_MAX_WIDTH, so LABEL_DISTANCE ≥ 140 / 0.684 ≈ 205.
//
// 215 satisfies both with a few units of breathing room.
const LABEL_DISTANCE = 215;
const LABEL_CLEAR_GAP = 10;
// Upper bound on the rendered width of the widest line a catalog name
// produces after splitLabel wraps it. At the desktop font (16 units)
// the test heuristic measures a 15-character line — the two longest
// catalog wraps, "Body Position &" and "Starts, Turns &" — at roughly
// 138.5 units; 140 rounds up to a comfortable upper bound. Also used
// in the adjacency-clearance derivation above, so changing one means
// re-checking LABEL_DISTANCE.
const LABEL_MAX_WIDTH = 140;
// Bbox height of a two-line label: 10 ascender + 17 line height + 3
// descender = 30. One-line labels are shorter but we size for the
// worst case so any ordering of catalog names fits.
const LABEL_MAX_HEIGHT = 30;

// Base font-size (viewBox units). Media queries scale this up one step at
// tablet and desktop; see the <style> block below. The LINE_HEIGHT ratio
// keeps two-line wraps from colliding at any font size.
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
export default function CategoryRadar({ categories, firstEvaluation }: CategoryRadarProps) {
  if (categories.length === 0) return null;
  const step = (Math.PI * 2) / categories.length;

  // Sentence-form text alternative.
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
          so we only reach for existing tokens. */}
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
        const lines = splitLabel(category.name);
        // Baselines are stacked LINE_HEIGHT apart and centered on
        // labelY, so a one-line label's baseline is labelY itself and a
        // two-line label's two baselines sit at labelY - LH/2 and
        // labelY + LH/2 — both lines share the same labelX, so the
        // block's horizontal center always sits on the axis.
        const baseY = labelY - ((lines.length - 1) / 2) * LINE_HEIGHT;
        const fill = category.assessedCount === 0 ? "var(--color-text-secondary)" : "var(--color-text)";
        const opacity = category.assessedCount === 0 ? 0.65 : 1;
        return (
          <text
            key={`label-${index}`}
            x={labelX}
            y={baseY}
            textAnchor="middle"
            fontWeight={500}
            fill={fill}
            opacity={opacity}
            className="category-radar-label"
            data-testid="category-radar-label"
          >
            {lines.map((line, lineIndex) => (
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

// Exported for tests: the ring geometry and the single label distance
// drive the "labels don't touch the chart" invariant, so tests compute
// bounding boxes against the same values the component renders.
export const __TEST__ = { CX, CY, SHAPE_RADIUS, LABEL_DISTANCE, LABEL_CLEAR_GAP, LABEL_MAX_WIDTH, LABEL_MAX_HEIGHT, LINE_HEIGHT, VB_WIDTH, VB_HEIGHT };
