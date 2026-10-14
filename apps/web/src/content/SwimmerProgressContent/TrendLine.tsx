import type { ProgressRatingPoint } from "@swim-app/shared";

interface TrendLineProps {
  history: ProgressRatingPoint[];
  width?: number;
  height?: number;
}

export default function TrendLine({ history, width = 64, height = 24 }: TrendLineProps) {
  // oldest to newest
  const points = [...history].reverse();
  const numericPoints = points.map((p) => {
    if (p.notLegal) return 0;
    if (p.noConcept) return null;
    return p.grade;
  });

  const nonNull = numericPoints.filter((v): v is number => v !== null);
  if (nonNull.length < 2) return null;

  const minVal = 0;
  const maxVal = 5;
  const range = maxVal - minVal;

  const coords = numericPoints
    .map((v, index) => {
      if (v === null) return null;
      const x = (index / (numericPoints.length - 1)) * width;
      const y = height - ((v - minVal) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .filter((c): c is string => c !== null)
    .join(" ");

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      className="shrink-0"
    >
      <polyline
        points={coords}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
