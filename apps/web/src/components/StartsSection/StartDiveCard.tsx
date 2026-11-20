"use client";

import type { ProgressRatingPoint, StartProgress } from "@swim-app/shared";
import {
  buildDiveArcPlot,
  buildSessionGridLookup,
  DISTANCE_LINE_START_X,
  DISTANCE_LINE_Y,
  DIVE_VIEW_HEIGHT,
  DIVE_VIEW_WIDTH,
  DIVE_WATERLINE_Y,
  DIVE_WATER_X_END,
  DIVE_WATER_X_START,
  distanceLineEndX,
  firstMeasurement,
  formatShortSessionDate,
  hasAnyGraded,
  latestMeasurement,
  levelRampColor,
  measurementChangeText,
  recentSessionDatesForStart,
  shortUnit,
  startComponentHistoryMap,
  ungradedCount,
  type ArcDot,
} from "./helpers";

// Fault tags aren't read anywhere inside the Starts code, so the prop
// accepts the structural intersection of coach and parent history
// shapes — the parent omits faultTags; the coach's extra field is
// simply ignored here.
type StartsHistoryPoint = Omit<ProgressRatingPoint, "faultTags">;

interface StartDiveCardProps {
  start: StartProgress;
  // Slice of SwimmerProgressResponse["skills"] — only the entries matching
  // this start's component slugs are read; the rest are ignored. Passed in
  // flat so the parent orchestrator doesn't thread two shapes through.
  swimmerSkills: Array<{
    slug: string;
    history: StartsHistoryPoint[];
  }>;
  // Swimmer's first name, used in the delta tile copy
  // ("0.06 s faster than <Name>'s first"). Required so the UI never
  // falls back to a hardcoded pronoun.
  swimmerFirstName: string;
  // Controls which card regions render. The coach progress page shows the
  // session-by-session grid + the "Still to grade" tile; the parent page
  // hides both — parents don't see per-session detail or coach-tempo
  // metadata. Defaults keep the coach behaviour unchanged.
  showSessionGrid?: boolean;
  showStillToGrade?: boolean;
}

export default function StartDiveCard({
  start,
  swimmerSkills,
  swimmerFirstName,
  showSessionGrid = true,
  showStillToGrade = true,
}: StartDiveCardProps) {
  if (!hasAnyGraded(start)) {
    return (
      <div
        className="p-4 rounded border"
        style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-surface-soft)" }}
        data-testid={`start-dive-card-empty-${start.slug}`}
      >
        <p className="text-sm text-text">
          Not started yet. Grade it from the Starts section of an evaluation.
        </p>
      </div>
    );
  }

  const plot = buildDiveArcPlot(start);
  const historyMap = startComponentHistoryMap(swimmerSkills, start.components);
  const sessionDates = recentSessionDatesForStart(start.components, historyMap);
  const sessionDatesOldestFirst = [...sessionDates].reverse();
  const sessionLookup = buildSessionGridLookup(start.components, historyMap);

  const reactionHistory = findMeasurementHistory(start, historyMap, "reaction");
  const distanceHistory = findMeasurementHistory(start, historyMap, "distance");
  const stillToGrade = ungradedCount(start);

  const srDescription = start.components
    .map((component) => {
      if (component.current === null) return `${component.name}: not graded yet`;
      if (component.current.notLegal) return `${component.name}: not legal`;
      if (component.current.noConcept) return `${component.name}: no concept`;
      if (component.current.grade === null) return `${component.name}: no rating`;
      return `${component.name}: level ${component.current.grade}`;
    })
    .join("; ");

  return (
    <div
      className="p-4 rounded border flex flex-col gap-5"
      style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-surface-soft)" }}
      data-testid={`start-dive-card-${start.slug}`}
    >
      <div
        className={
          showSessionGrid
            ? "grid gap-5 desktop:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] items-start"
            : "flex flex-col gap-3"
        }
      >
        <div className="flex flex-col gap-3 min-w-0">
          <DiveArcSvg plot={plot} startName={start.name} srDescription={srDescription} />
          <StatTiles
            reactionHistory={reactionHistory}
            distanceHistory={distanceHistory}
            stillToGrade={stillToGrade}
            swimmerFirstName={swimmerFirstName}
            showStillToGrade={showStillToGrade}
          />
        </div>

        {showSessionGrid && (
          <div className="flex flex-col gap-2 min-w-0">
            <span className="font-semibold text-sm text-text">Each part, session by session</span>
            <ComponentSessionGrid
              components={start.components}
              sessionDates={sessionDatesOldestFirst}
              lookup={sessionLookup}
            />
            <p className="text-xs text-text-secondary">
              The start gets its overall grade once every component is graded.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Dive arc SVG ─────────────────────────────────────────────────────────

interface DiveArcSvgProps {
  plot: ReturnType<typeof buildDiveArcPlot>;
  startName: string;
  srDescription: string;
}

function DiveArcSvg({ plot, startName, srDescription }: DiveArcSvgProps) {
  const distanceLineEnd = plot.distance ? distanceLineEndX(plot.distance.valueFeet) : null;

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${DIVE_VIEW_WIDTH} ${DIVE_VIEW_HEIGHT}`}
      role="img"
      aria-label={`${startName} dive`}
      className="rounded"
      data-testid="dive-arc-svg"
    >
      <title>{`${startName} dive`}</title>
      <desc>{srDescription}</desc>

      {/* Water band + waterline */}
      <rect
        x={DIVE_WATER_X_START}
        y={DIVE_WATERLINE_Y}
        width={DIVE_WATER_X_END - DIVE_WATER_X_START}
        height={DIVE_VIEW_HEIGHT - DIVE_WATERLINE_Y - 4}
        fill="color-mix(in oklab, var(--color-accent) 12%, var(--color-background))"
      />
      <line
        x1={DIVE_WATER_X_START}
        y1={DIVE_WATERLINE_Y}
        x2={DIVE_WATER_X_END}
        y2={DIVE_WATERLINE_Y}
        stroke="var(--color-accent)"
        strokeOpacity={0.5}
        strokeWidth={1.5}
      />

      {/* Block (track/relay) or wall stub (back) */}
      {plot.kind === "block" ? (
        <rect x={30} y={64} width={60} height={102} rx={4} fill="var(--color-border)" />
      ) : (
        <rect x={10} y={DIVE_WATERLINE_Y - 20} width={20} height={40} rx={2} fill="var(--color-border)" />
      )}

      {/* Dive trajectory */}
      <path
        d={plot.arcPath}
        fill="none"
        stroke="var(--color-text-secondary)"
        strokeWidth={2}
        strokeDasharray="2 7"
        strokeLinecap="round"
      />

      {/* Component dots along the arc */}
      {plot.dots.map((dot, index) => (
        <ArcDotMark key={dot.slug} dot={dot} dotIndex={index} />
      ))}

      {/* Distance: entry dot + measured line + value label. Falls back to a
          dashed empty circle at the arc-end when the component is present
          but no level has been assigned yet. */}
      {plot.distance && (
        <>
          {plot.distance.level !== null && !plot.distance.notLegal && !plot.distance.noConcept ? (
            <circle
              cx={DISTANCE_LINE_START_X + 2}
              cy={DIVE_WATERLINE_Y}
              r={6}
              fill={levelRampColor(plot.distance.level).background}
              stroke="var(--color-accent)"
              strokeWidth={1.5}
            />
          ) : (
            <circle
              cx={DISTANCE_LINE_START_X + 2}
              cy={DIVE_WATERLINE_Y}
              r={6}
              fill="transparent"
              stroke="var(--color-text-secondary)"
              strokeWidth={1.5}
              strokeDasharray="3 3"
            />
          )}
          {distanceLineEnd !== null && plot.distance.valueFeet !== null && (
            <>
              <line
                x1={DISTANCE_LINE_START_X}
                y1={DISTANCE_LINE_Y}
                x2={distanceLineEnd}
                y2={DISTANCE_LINE_Y}
                stroke="var(--color-accent)"
                strokeWidth={1.5}
              />
              <line
                x1={DISTANCE_LINE_START_X}
                y1={DISTANCE_LINE_Y - 6}
                x2={DISTANCE_LINE_START_X}
                y2={DISTANCE_LINE_Y + 6}
                stroke="var(--color-accent)"
                strokeWidth={1.5}
              />
              <line
                x1={distanceLineEnd}
                y1={DISTANCE_LINE_Y - 6}
                x2={distanceLineEnd}
                y2={DISTANCE_LINE_Y + 6}
                stroke="var(--color-accent)"
                strokeWidth={1.5}
              />
              <text
                x={(DISTANCE_LINE_START_X + distanceLineEnd) / 2}
                y={DISTANCE_LINE_Y + 14}
                fontSize={12}
                fontWeight={600}
                fill="var(--color-accent)"
                textAnchor="middle"
              >
                {`Distance ${plot.distance.valueLabel}`}
              </text>
            </>
          )}
        </>
      )}
    </svg>
  );
}

function ArcDotMark({ dot, dotIndex: _dotIndex }: { dot: ArcDot; dotIndex: number }) {
  const labelY = dot.labelAbove ? dot.y - 22 : dot.y + 32;
  const graded = dot.level !== null && !dot.notLegal && !dot.noConcept;
  const ramp = levelRampColor(dot.level);

  return (
    <g data-testid="dive-arc-dot" data-component={dot.slug}>
      {graded ? (
        <>
          <circle cx={dot.x} cy={dot.y} r={15} fill={ramp.background} />
          <text
            x={dot.x}
            y={dot.y + 5}
            fontSize={13}
            fontWeight={700}
            fill={ramp.color}
            textAnchor="middle"
            aria-hidden="true"
          >
            {dot.level}
          </text>
        </>
      ) : dot.notLegal ? (
        <>
          <circle cx={dot.x} cy={dot.y} r={15} fill="var(--color-danger)" />
          <text
            x={dot.x}
            y={dot.y + 4}
            fontSize={10}
            fontWeight={700}
            fill="var(--color-on-danger)"
            textAnchor="middle"
            aria-hidden="true"
          >
            NL
          </text>
        </>
      ) : dot.noConcept ? (
        <>
          <circle cx={dot.x} cy={dot.y} r={15} fill="var(--color-surface-soft)" />
          <text
            x={dot.x}
            y={dot.y + 4}
            fontSize={10}
            fontWeight={700}
            fill="var(--color-text-secondary)"
            textAnchor="middle"
            aria-hidden="true"
          >
            NC
          </text>
        </>
      ) : (
        <circle
          cx={dot.x}
          cy={dot.y}
          r={14}
          fill="transparent"
          stroke="var(--color-text-secondary)"
          strokeWidth={1.5}
          strokeDasharray="3 3"
        />
      )}
      <text
        x={dot.x}
        y={labelY}
        // CSS px (not SVG units) so the label stays legible when the
        // SVG scales down at 375px. textAnchor="middle" keeps the label
        // centred on the dot; alternation (labelAbove/below set in the
        // plot helper) prevents vertical overlap between neighbours.
        style={{ fontSize: "11px", fill: "var(--color-text-secondary)" }}
        textAnchor="middle"
        data-testid="dive-arc-label"
        data-component={dot.slug}
        data-label-side={dot.labelAbove ? "above" : "below"}
      >
        {dot.shortName}
      </text>
    </g>
  );
}

// ── Stat tiles ───────────────────────────────────────────────────────────

interface StatTilesProps {
  reactionHistory: ProgressRatingPoint[];
  distanceHistory: ProgressRatingPoint[];
  stillToGrade: number;
  swimmerFirstName: string;
  // Parent view hides the still-to-grade count; it reads as coach tempo
  // metadata rather than a swimmer-progress fact.
  showStillToGrade?: boolean;
}

function StatTiles({ reactionHistory, distanceHistory, stillToGrade, swimmerFirstName, showStillToGrade = true }: StatTilesProps) {
  const reactionFirst = firstMeasurement(reactionHistory);
  const reactionLatest = latestMeasurement(reactionHistory);
  const distanceFirst = firstMeasurement(distanceHistory);
  const distanceLatest = latestMeasurement(distanceHistory);

  const tiles: Array<{ key: string; label: string; value: string; change: string | null }> = [];

  if (reactionLatest && reactionLatest.measurementValue !== null && reactionLatest.measurementUnit !== null) {
    tiles.push({
      key: "reaction",
      label: "Reaction time",
      value: `${reactionLatest.measurementValue} ${shortUnit(reactionLatest.measurementUnit)}`.trim(),
      // When firstMeasurement and latestMeasurement return the same rating
      // (only one measurement in the history), there's no delta to
      // report — the change text collapses to "First measurement".
      change: measurementChangeText(
        reactionFirst?.measurementValue ?? null,
        reactionFirst?.measurementUnit ?? null,
        reactionLatest.measurementValue,
        reactionLatest.measurementUnit,
        swimmerFirstName,
        { isFirstOnly: reactionFirst !== null && reactionFirst.id === reactionLatest.id },
      ),
    });
  }

  if (distanceLatest && distanceLatest.measurementValue !== null && distanceLatest.measurementUnit !== null) {
    tiles.push({
      key: "distance",
      label: "Entry distance",
      value: `${distanceLatest.measurementValue} ${shortUnit(distanceLatest.measurementUnit)}`.trim(),
      change: measurementChangeText(
        distanceFirst?.measurementValue ?? null,
        distanceFirst?.measurementUnit ?? null,
        distanceLatest.measurementValue,
        distanceLatest.measurementUnit,
        swimmerFirstName,
        { isFirstOnly: distanceFirst !== null && distanceFirst.id === distanceLatest.id },
      ),
    });
  }

  if (showStillToGrade && stillToGrade > 0) {
    tiles.push({
      key: "stillToGrade",
      label: "Still to grade",
      value: String(stillToGrade),
      change: null,
    });
  }

  if (tiles.length === 0) return null;

  return (
    <div
      className="grid gap-2"
      style={{ gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))" }}
      data-testid="start-stat-tiles"
    >
      {tiles.map((tile) => (
        <div
          key={tile.key}
          className="rounded border p-3 flex flex-col gap-0.5"
          // Tiles sit INSIDE the surface-soft card, so they use the page
          // background so the elevation reads. Both tokens are light in
          // light mode and dark in dark mode, so the stacking reads in
          // both themes.
          style={{ borderColor: "var(--color-border)", backgroundColor: "var(--color-background)" }}
          data-testid={`start-stat-tile-${tile.key}`}
        >
          <span className="text-xs text-text-secondary">{tile.label}</span>
          <span className="font-heading text-xl font-semibold text-text tabular-nums">{tile.value}</span>
          {tile.change && (
            <span className="text-xs text-text-secondary" data-testid={`start-stat-change-${tile.key}`}>
              {tile.change}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Session grid ─────────────────────────────────────────────────────────

interface ComponentSessionGridProps {
  components: StartProgress["components"];
  sessionDates: string[];     // oldest-first
  lookup: Map<string, Map<string, ReturnType<typeof buildSessionGridLookup> extends Map<string, Map<string, infer V>> ? V : never>>;
}

function ComponentSessionGrid({ components, sessionDates, lookup }: ComponentSessionGridProps) {
  if (sessionDates.length === 0) {
    return (
      <p className="text-xs text-text-secondary">No per-component ratings yet.</p>
    );
  }

  const nameColumnWidth = "minmax(0, 1.5fr)";
  const dateColumnWidth = "36px";
  const gridTemplate = `${nameColumnWidth} repeat(${sessionDates.length}, ${dateColumnWidth})`;
  const minColumnTotal = sessionDates.length * 36 + 110;

  return (
    <div className="overflow-x-auto -mx-1" data-testid="start-session-grid-scroller">
      <div className="px-1" style={{ minWidth: `${minColumnTotal}px` }}>
        <div className="grid gap-1 items-center" style={{ gridTemplateColumns: gridTemplate }} data-testid="start-session-grid">
          <span />
          {sessionDates.map((date) => (
            <span
              key={date}
              className="text-[10px] text-text-secondary text-center leading-tight"
            >
              {formatShortSessionDate(date)}
            </span>
          ))}
          {components.map((component) => (
            <SessionGridRow
              key={component.slug}
              component={component}
              sessionDates={sessionDates}
              perDate={lookup.get(component.slug) ?? new Map()}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function SessionGridRow({
  component,
  sessionDates,
  perDate,
}: {
  component: StartProgress["components"][number];
  sessionDates: string[];
  perDate: Map<string, { grade: 1 | 2 | 3 | 4 | 5 | null; notLegal: boolean; noConcept: boolean }>;
}) {
  const rowNeverRated = component.current === null;
  return (
    <>
      <span
        className="text-xs truncate"
        style={{ color: rowNeverRated ? "var(--color-text-secondary)" : "var(--color-text)" }}
      >
        {component.name}
      </span>
      {sessionDates.map((date) => {
        const cell = perDate.get(date);
        if (!cell) return <GridCell key={`${component.slug}-${date}`} empty slug={component.slug} date={date} />;
        if (cell.notLegal) {
          return (
            <GridCell key={`${component.slug}-${date}`} slug={component.slug} date={date}>
              <span
                className="w-full h-6 rounded flex items-center justify-center text-[10px] font-semibold"
                style={{ backgroundColor: "var(--color-danger)", color: "var(--color-on-danger)" }}
              >
                NL
              </span>
            </GridCell>
          );
        }
        if (cell.noConcept) {
          return (
            <GridCell key={`${component.slug}-${date}`} slug={component.slug} date={date}>
              <span
                className="w-full h-6 rounded flex items-center justify-center text-[10px] font-semibold"
                style={{ backgroundColor: "var(--color-surface-soft)", color: "var(--color-text-secondary)" }}
              >
                NC
              </span>
            </GridCell>
          );
        }
        if (cell.grade === null) {
          return <GridCell key={`${component.slug}-${date}`} empty slug={component.slug} date={date} />;
        }
        const ramp = levelRampColor(cell.grade);
        return (
          <GridCell key={`${component.slug}-${date}`} slug={component.slug} date={date}>
            <span
              className="w-full h-6 rounded flex items-center justify-center text-xs font-semibold"
              style={{ backgroundColor: ramp.background, color: ramp.color }}
            >
              {cell.grade}
            </span>
          </GridCell>
        );
      })}
    </>
  );
}

function GridCell({
  children,
  empty,
  slug,
  date,
}: {
  children?: React.ReactNode;
  empty?: boolean;
  slug: string;
  date: string;
}) {
  if (empty) {
    return (
      <span
        className="w-full h-6 rounded"
        style={{ border: "1px dashed var(--color-border)" }}
        data-testid="start-session-grid-empty"
        data-component={slug}
        data-session-date={date}
        aria-hidden="true"
      />
    );
  }
  return (
    <span
      className="w-full h-6 flex items-center justify-center"
      data-testid="start-session-grid-cell"
      data-component={slug}
      data-session-date={date}
    >
      {children}
    </span>
  );
}

// ── Measurement history lookup ───────────────────────────────────────────

// Finds the first component slug containing `role` ("reaction" / "distance")
// and returns its history. Start components use the shared role naming
// (`track-start-reaction`, `back-start-reaction`, …), so a substring match
// is enough to pick the right one across all three start kinds.
function findMeasurementHistory(
  start: StartProgress,
  historyMap: Map<string, ProgressRatingPoint[]>,
  role: "reaction" | "distance",
): ProgressRatingPoint[] {
  const match = start.components.find((component) => component.slug.endsWith(`-${role}`));
  if (!match) return [];
  return historyMap.get(match.slug) ?? [];
}
