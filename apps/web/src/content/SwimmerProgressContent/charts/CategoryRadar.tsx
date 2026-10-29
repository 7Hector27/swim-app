"use client";

interface CategoryRadarProps {
  categories: Array<{ name: string; average: number | null; assessedCount: number }>;
}

// Radar snapshot of category averages, 1-5 scale.
// Unassessed categories draw at the center and dim their axis label; the
// polygon still closes so the shape stays coherent.
export default function CategoryRadar({ categories }: CategoryRadarProps) {
  if (categories.length === 0) return null;
  const size = 320;
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 56;
  const step = (Math.PI * 2) / categories.length;

  function pointAt(axisIndex: number, value: number): { x: number; y: number } {
    const angle = -Math.PI / 2 + axisIndex * step;
    const scaled = (value / 5) * radius;
    return { x: cx + Math.cos(angle) * scaled, y: cy + Math.sin(angle) * scaled };
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
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label="Category score snapshot"
      className="rounded-[var(--radius-card)]"
      style={{ backgroundColor: "var(--color-surface-soft)" }}
    >
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
          stroke="var(--color-border)"
          strokeWidth={0.75}
          opacity={ring === 5 ? 0.9 : 0.5}
        />
      ))}
      {categories.map((_, index) => {
        const outer = pointAt(index, 5);
        return (
          <line
            key={index}
            x1={cx}
            y1={cy}
            x2={outer.x}
            y2={outer.y}
            stroke="var(--color-border)"
            strokeWidth={0.5}
            opacity={0.6}
          />
        );
      })}
      <polygon
        points={polygon}
        fill="var(--color-accent)"
        fillOpacity={0.18}
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
        const outer = pointAt(index, 5);
        const labelX = cx + (outer.x - cx) * 1.22;
        const labelY = cy + (outer.y - cy) * 1.22;
        const anchor: "start" | "middle" | "end" =
          Math.abs(outer.x - cx) < 1 ? "middle" : outer.x > cx ? "start" : "end";
        return (
          <text
            key={`label-${index}`}
            x={labelX}
            y={labelY + 4}
            textAnchor={anchor}
            fontSize={12}
            fill={category.assessedCount === 0 ? "var(--color-text-secondary)" : "var(--color-text)"}
            opacity={category.assessedCount === 0 ? 0.6 : 1}
          >
            {category.name}
          </text>
        );
      })}
    </svg>
  );
}
