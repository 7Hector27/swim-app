import {
  averageToX,
  buildAriaLabel,
  FIRST_ROW_Y,
  HEADER_Y,
  laneIsRated,
  laneTextY,
  laneTrackY,
  RIGHT_LABEL_X,
  ROW_STEP,
  SCALE_X_POSITIONS,
  TRACK_X_END,
  TRACK_X_START,
  totalViewHeight,
  type Lane,
} from "./helpers";

interface WhereSheStandsProps {
  lanes: ReadonlyArray<Lane>;
}

// One lane per skill group on a 1-5 track. A ring marks the first evaluation
// average and a dot marks the current one, with "<avg> · <rated> of <total>"
// at the right. Groups with no rated skills (first or current) render a
// dotted lane and "Not rated yet."
//
// The SVG has its own light-surface background and border radius so the
// component reads as a card without needing an outer wrapper — matching the
// CategoryRadar snapshot it pairs with.
export default function WhereSheStands({ lanes }: WhereSheStandsProps) {
  if (lanes.length === 0) return null;
  const height = totalViewHeight(lanes.length);

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${RIGHT_LABEL_X} ${height}`}
      role="img"
      aria-label={buildAriaLabel(lanes)}
      className="rounded-[var(--radius-card)] block"
      style={{ backgroundColor: "var(--color-surface-soft)", padding: "16px 20px" }}
      data-testid="where-she-stands"
    >
      <style>{`
        .wss-web { stroke: var(--color-placeholder-border); }
        [data-theme="dark"] .wss-web { stroke: var(--color-border); }
      `}</style>

      {/* 1-5 scale header */}
      {SCALE_X_POSITIONS.map((x, index) => (
        <text
          key={index}
          x={x}
          y={HEADER_Y}
          fontSize={11}
          fill="var(--color-text-secondary)"
          textAnchor="middle"
        >
          {index + 1}
        </text>
      ))}

      {lanes.map((lane, index) => (
        <LaneRow key={lane.slug} lane={lane} index={index} />
      ))}
    </svg>
  );
}

function LaneRow({ lane, index }: { lane: Lane; index: number }) {
  const trackY = laneTrackY(index);
  const textY = laneTextY(index);
  const rated = laneIsRated(lane);
  const nameFill = rated ? "var(--color-text)" : "var(--color-text-secondary)";
  const currentX = lane.currentAverage !== null ? averageToX(lane.currentAverage) : null;
  const firstX = lane.firstAverage !== null ? averageToX(lane.firstAverage) : null;

  return (
    <g data-testid="where-she-stands-lane" data-slug={lane.slug} data-rated={rated ? "true" : "false"}>
      <text x={0} y={textY} fontSize={13} fill={nameFill}>
        {lane.name}
      </text>

      {rated ? (
        <>
          <line
            x1={TRACK_X_START}
            y1={trackY}
            x2={TRACK_X_END}
            y2={trackY}
            className="wss-web"
            strokeWidth={6}
            strokeLinecap="round"
          />
          {firstX !== null && currentX !== null && (
            <line
              x1={Math.min(firstX, currentX)}
              y1={trackY}
              x2={Math.max(firstX, currentX)}
              y2={trackY}
              stroke="var(--color-accent)"
              strokeWidth={6}
              strokeLinecap="round"
              opacity={0.6}
            />
          )}
          {firstX !== null && (
            <circle
              cx={firstX}
              cy={trackY}
              r={5}
              fill="var(--color-surface-soft)"
              stroke="var(--color-text)"
              strokeWidth={2}
              data-testid="where-she-stands-ring"
              data-slug={lane.slug}
              data-cx={firstX.toFixed(2)}
            />
          )}
          {currentX !== null && (
            <circle
              cx={currentX}
              cy={trackY}
              r={8}
              fill="var(--color-accent)"
              data-testid="where-she-stands-dot"
              data-slug={lane.slug}
              data-cx={currentX.toFixed(2)}
            />
          )}
          <text
            x={RIGHT_LABEL_X}
            y={textY}
            fontSize={12}
            fill="var(--color-text-secondary)"
            textAnchor="end"
          >
            {lane.currentAverage !== null ? lane.currentAverage.toFixed(1) : "—"}
            {" · "}
            {lane.currentAssessedCount} of {lane.totalCount}
          </text>
        </>
      ) : (
        <>
          <line
            x1={TRACK_X_START}
            y1={trackY}
            x2={TRACK_X_END}
            y2={trackY}
            className="wss-web"
            strokeWidth={6}
            strokeLinecap="round"
            strokeDasharray="1 12"
            data-testid="where-she-stands-not-rated-track"
          />
          <text
            x={RIGHT_LABEL_X}
            y={textY}
            fontSize={12}
            fill="var(--color-text-secondary)"
            textAnchor="end"
          >
            Not rated yet
          </text>
        </>
      )}
    </g>
  );
}

// Export the lane helpers via the barrel so pages can build lanes from
// screen-group snapshots.
export { FIRST_ROW_Y, ROW_STEP };
