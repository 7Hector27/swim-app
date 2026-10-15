type TrendPoint = { grade: number | null; notLegal: boolean; noConcept: boolean };

interface TrendLineProps {
  history: TrendPoint[];
  width?: number;
  height?: number;
}

export default function TrendLine({ history, width = 64, height = 24 }: TrendLineProps) {
  // oldest to newest
  const points = [...history].reverse();
  const numericPoints = points.map((point) => {
    if (point.notLegal) return 0;
    if (point.noConcept) return null;
    return point.grade;
  });

  const nonNull = numericPoints.filter((value): value is number => value !== null);
  if (nonNull.length < 2) return null;

  const minVal = 0;
  const maxVal = 5;
  const range = maxVal - minVal;

  const coords = numericPoints
    .map((value, index) => {
      if (value === null) return null;
      const x = (index / (numericPoints.length - 1)) * width;
      const y = height - ((value - minVal) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .filter((coord): coord is string => coord !== null)
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
