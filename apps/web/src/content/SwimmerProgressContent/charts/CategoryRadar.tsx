"use client";

interface CategoryRadarProps {
  categories: Array<{ name: string; average: number | null; assessedCount: number }>;
}

// viewBox is wider than tall because side labels (end/start anchored) need
// generous horizontal padding, while top and bottom labels only need enough
// vertical room for two lines of text. Sized so even the longest two-line
// label — "Starts, Turns &" / "Underwaters" — fits inside at the desktop
// breakpoint's enlarged font (15 viewBox units) without clipping.
const VB_WIDTH = 580;
const VB_HEIGHT = 400;
const CX = VB_WIDTH / 2;
const CY = VB_HEIGHT / 2;
// Distance from center to the label anchor point. The shape radius sits
// well inside this so dots don't collide with text.
const LABEL_DISTANCE = 150;
const SHAPE_RADIUS = 115;
// Base font-size (viewBox units). Media queries scale this up one step at
// tablet and desktop; see the <style> block below. The LINE_HEIGHT ratio
// below the base keeps two-line wraps from colliding at any font size.
const FONT_SIZE_PHONE = 13;
const FONT_SIZE_TABLET = 14;
const FONT_SIZE_DESKTOP = 15;
const LINE_HEIGHT = 16;

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
export default function CategoryRadar({ categories }: CategoryRadarProps) {
  if (categories.length === 0) return null;
  const step = (Math.PI * 2) / categories.length;

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

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${VB_WIDTH} ${VB_HEIGHT}`}
      role="img"
      aria-label="Category score snapshot"
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
        const lines = splitLabel(category.name);
        // Vertical placement: lines are stacked around labelY. Top-of-chart
        // labels (sinA negative) sit above the point so the baseline doesn't
        // overlap the shape; bottom labels sit below; sides are centered.
        const topBias = sinA < -0.5 ? -(lines.length - 1) * LINE_HEIGHT : sinA > 0.5 ? LINE_HEIGHT : -((lines.length - 1) / 2) * LINE_HEIGHT;
        const baseY = labelY + topBias;
        const fill = category.assessedCount === 0 ? "var(--color-text-secondary)" : "var(--color-text)";
        const opacity = category.assessedCount === 0 ? 0.65 : 1;
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
