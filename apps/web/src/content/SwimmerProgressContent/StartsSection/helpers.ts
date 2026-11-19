// Pure logic for the Starts section: tab labels, initial-tab selection,
// dive-arc geometry, change-text under the stat tiles, session-grid
// assembly. Separated from the UI so the drawing math is unit-testable
// and later chart surfaces can reuse the same primitives.

import type {
  MeasurementUnit,
  ProgressRatingPoint,
  StartComponentProgress,
  StartProgress,
} from "@swim-app/shared";

// ── Tab labels ────────────────────────────────────────────────────────────

// Text shown next to a start's name in its tab. Mirrors the mock's status
// vocabulary ("Grade N", "N of M", "Not legal", "Not started", "No concept").
// "N of M" is shown for in_progress starts with at least one graded
// component; a start with zero graded components reads "Not started".
export function tabStatusLabel(start: StartProgress): string {
  if (start.grade.status === "graded") return `Grade ${start.grade.grade}`;
  if (start.grade.status === "not_legal") return "Not legal";
  if (start.grade.status === "no_concept") return "No concept";
  // in_progress
  const graded = start.components.filter((component) => component.current !== null).length;
  if (graded === 0) return "Not started";
  return `${graded} of ${start.components.length}`;
}

export function ungradedCount(start: StartProgress): number {
  return start.components.filter((component) => component.current === null).length;
}

export function hasAnyGraded(start: StartProgress): boolean {
  return start.components.some((component) => component.current !== null);
}

// First start with any graded component, else the first start in the list.
// Returns null when there are no starts at all.
export function pickInitialStartSlug(startProgress: StartProgress[]): string | null {
  const firstGraded = startProgress.find(hasAnyGraded);
  if (firstGraded) return firstGraded.slug;
  return startProgress[0]?.slug ?? null;
}

// ── Dive-arc geometry ────────────────────────────────────────────────────

// SVG virtual coordinate system. Matches the mock's viewBox so the geometry
// can be read against the design file directly. Width stays 100% in CSS;
// the viewBox below defines the internal units.
export const DIVE_VIEW_WIDTH = 680;
export const DIVE_VIEW_HEIGHT = 170;
// Waterline sits at y=130 so there's a 40-unit "water" band at the bottom
// of the SVG where the distance line and the entry point live.
export const DIVE_WATERLINE_Y = 130;
export const DIVE_WATER_X_START = 90;
export const DIVE_WATER_X_END = 670;

// Two arc shapes keyed by start kind. The "block" arc starts high (on top
// of the block at left) and lands on the water to the right; the "wall"
// arc starts at water level (swimmer gripping the wall) and arcs back and
// up before diving in. Both end at (560, 128) — just above the waterline —
// so the distance line's origin is consistent across start kinds.
export const BLOCK_ARC_START = { x: 60, y: 50 } as const;
export const BLOCK_ARC_CONTROL = { x: 300, y: -20 } as const;
export const BLOCK_ARC_END = { x: 560, y: 128 } as const;

export const WALL_ARC_START = { x: 90, y: 118 } as const;
export const WALL_ARC_CONTROL = { x: 280, y: -30 } as const;
export const WALL_ARC_END = { x: 560, y: 128 } as const;

export function diveArcPath(kind: "block" | "wall"): string {
  if (kind === "wall") {
    return `M${WALL_ARC_START.x} ${WALL_ARC_START.y} Q ${WALL_ARC_CONTROL.x} ${WALL_ARC_CONTROL.y} ${WALL_ARC_END.x} ${WALL_ARC_END.y}`;
  }
  return `M${BLOCK_ARC_START.x} ${BLOCK_ARC_START.y} Q ${BLOCK_ARC_CONTROL.x} ${BLOCK_ARC_CONTROL.y} ${BLOCK_ARC_END.x} ${BLOCK_ARC_END.y}`;
}

// Quadratic Bezier evaluator: given P0, P1 (control), P2 and t in [0, 1],
// returns the point on the curve. Exposed so tests can assert that
// components-in-order land at predictable positions.
export function bezierPoint(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  t: number,
): { x: number; y: number } {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
  };
}

// Does this component slug represent the "Distance" measurement? The three
// start-parent catalogs (track, relay, back) all use the `<start>-distance`
// convention. A startsWith / endsWith check avoids name drift when the
// display name is edited.
export function isDistanceComponent(slug: string): boolean {
  return slug.endsWith("-distance");
}

export interface ArcDot {
  slug: string;
  name: string;
  // Short version of `name` used as the arc label so it doesn't collide with
  // its neighbour at 375px. The session grid and the SVG's sr-only
  // description keep the full name. See shortArcLabel() below.
  shortName: string;
  x: number;
  y: number;
  level: 1 | 2 | 3 | 4 | 5 | null;    // null → not graded yet (dashed empty circle)
  notLegal: boolean;
  noConcept: boolean;
  labelAbove: boolean;                 // place the name label above the dot
}

// Short arc label by component-slug suffix. The brief lists the exact
// vocabulary — Reaction / Acceleration / Height / Entry / Legs / Distance
// for block starts, Reaction / Push / Arch / Entry for backstroke — so the
// mapping is encoded here rather than derived from the full name.
export function shortArcLabel(slug: string): string {
  if (slug.endsWith("-reaction")) return "Reaction";
  if (slug.endsWith("-acceleration")) return "Acceleration";
  if (slug.endsWith("-height")) return "Height";
  if (slug.endsWith("-leg-feet")) return "Legs";
  if (slug.endsWith("-head-arm-hand")) return "Entry";
  if (slug.endsWith("-entry-alignment")) return "Entry";
  if (slug.endsWith("-push")) return "Push";
  if (slug.endsWith("-arch")) return "Arch";
  if (slug.endsWith("-streamline")) return "Streamline";
  if (slug.endsWith("-distance")) return "Distance";
  // Fallback: use the first space-separated word of the display name.
  return slug;
}

export interface DistanceDrawing {
  slug: string;
  name: string;
  valueFeet: number | null;            // numeric distance value when measured
  valueLabel: string | null;           // "7 ft" when measured
  graded: boolean;                     // overall level graded (fills the dot)
  level: 1 | 2 | 3 | 4 | 5 | null;
  notLegal: boolean;
  noConcept: boolean;
}

export interface DiveArcPlot {
  kind: "block" | "wall";
  arcPath: string;
  dots: ArcDot[];
  distance: DistanceDrawing | null;
}

// Top-level: take a StartProgress and produce an SVG-ready plot. Non-distance
// components are placed along the arc at evenly spaced fractions
// (0, 1/(N-1), …, 1). The distance component is split off and drawn as a
// line + value on the water.
//
// Backstroke start uses the wall layout; track/relay use the block layout.
// The kind is keyed by slug so a future "freestyle-start" would need an
// explicit entry here — intentional, so the drawing stays deliberate.
export function buildDiveArcPlot(start: StartProgress): DiveArcPlot {
  const kind: "block" | "wall" = start.slug === "back-start" ? "wall" : "block";
  const arcPath = diveArcPath(kind);
  const p0 = kind === "wall" ? WALL_ARC_START : BLOCK_ARC_START;
  const p1 = kind === "wall" ? WALL_ARC_CONTROL : BLOCK_ARC_CONTROL;
  const p2 = kind === "wall" ? WALL_ARC_END : BLOCK_ARC_END;

  const nonDistance = start.components.filter((component) => !isDistanceComponent(component.slug));
  const distance = start.components.find((component) => isDistanceComponent(component.slug)) ?? null;

  const count = nonDistance.length;
  const dots: ArcDot[] = nonDistance.map((component, index) => {
    const t = count <= 1 ? 0.5 : index / (count - 1);
    const point = bezierPoint(p0, p1, p2, t);
    return {
      slug: component.slug,
      name: component.name,
      shortName: shortArcLabel(component.slug),
      x: point.x,
      y: point.y,
      level: componentLevel(component.current),
      notLegal: component.current?.notLegal ?? false,
      noConcept: component.current?.noConcept ?? false,
      // Even indices read below, odd indices above — keeps labels from
      // colliding when circles land close together near the apex.
      labelAbove: index % 2 === 0,
    };
  });

  const distanceDrawing: DistanceDrawing | null = distance
    ? {
        slug: distance.slug,
        name: distance.name,
        valueFeet: parseDistanceFeet(distance.current),
        valueLabel: distanceValueLabel(distance.current),
        graded: distance.current !== null,
        level: componentLevel(distance.current),
        notLegal: distance.current?.notLegal ?? false,
        noConcept: distance.current?.noConcept ?? false,
      }
    : null;

  return { kind, arcPath, dots, distance: distanceDrawing };
}

function componentLevel(
  current: StartComponentProgress["current"],
): 1 | 2 | 3 | 4 | 5 | null {
  if (current === null) return null;
  if (current.notLegal || current.noConcept) return null;
  if (current.grade === 1 || current.grade === 2 || current.grade === 3 || current.grade === 4 || current.grade === 5) {
    return current.grade;
  }
  return null;
}

function parseDistanceFeet(current: StartComponentProgress["current"]): number | null {
  if (current === null || current.measurementValue === null) return null;
  const parsed = Number(current.measurementValue);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function distanceValueLabel(current: StartComponentProgress["current"]): string | null {
  if (current === null || current.measurementValue === null) return null;
  return `${current.measurementValue} ${shortUnit(current.measurementUnit)}`.trim();
}

// 15 ft is a long dive entry — longer than almost any swimmer. Clamping at
// that cap keeps the visual line from running off the water band. The
// returned pixel length is measured in SVG units.
const DISTANCE_MAX_FEET = 15;
const DISTANCE_LINE_X_START = 92;
const DISTANCE_LINE_X_END = 660;
const DISTANCE_LINE_WIDTH = DISTANCE_LINE_X_END - DISTANCE_LINE_X_START;

export function distanceLineEndX(valueFeet: number | null): number {
  if (valueFeet === null || valueFeet <= 0) return DISTANCE_LINE_X_START;
  const capped = Math.min(valueFeet, DISTANCE_MAX_FEET);
  return DISTANCE_LINE_X_START + (capped / DISTANCE_MAX_FEET) * DISTANCE_LINE_WIDTH;
}

export const DISTANCE_LINE_Y = 150;
export const DISTANCE_LINE_START_X = DISTANCE_LINE_X_START;

// ── Measurement change text ──────────────────────────────────────────────

// "0.06 s faster than her first" | "1 ft farther than her first" |
// "First measurement" when there's only one data point.
// Returns null when the component has no measurement history.
//
// `isFirstOnly` lets the caller flag that the first-measurement and
// latest-measurement point to the same rating in history — otherwise a
// single-measurement row would hit the delta=0 branch and read "Same as
// her first N", which falsely implies a comparison across two sessions.
export function measurementChangeText(
  firstValue: string | null,
  firstUnit: MeasurementUnit | null,
  latestValue: string | null,
  latestUnit: MeasurementUnit | null,
  options: { isFirstOnly?: boolean } = {},
): string | null {
  if (latestValue === null || latestUnit === null) return null;
  if (options.isFirstOnly) {
    return "First measurement";
  }
  if (firstValue === null || firstUnit === null) {
    return "First measurement";
  }
  if (firstUnit !== latestUnit) {
    // Units drifted between the first and latest ratings — refuse to compare
    // rather than render nonsense.
    return `${latestValue} ${shortUnit(latestUnit)}`.trim();
  }
  const first = Number(firstValue);
  const latest = Number(latestValue);
  if (!Number.isFinite(first) || !Number.isFinite(latest)) {
    return `${latestValue} ${shortUnit(latestUnit)}`.trim();
  }
  const delta = Math.round((latest - first) * 100) / 100;
  if (delta === 0) {
    return `Same as her first ${firstValue} ${shortUnit(firstUnit)}`.trim();
  }
  const abs = Math.abs(delta);
  const direction = changeDirection(delta, latestUnit);
  return `${formatDeltaNumber(abs)} ${shortUnit(latestUnit)} ${direction} than her first`;
}

function changeDirection(delta: number, unit: MeasurementUnit): string {
  if (unit === "seconds") return delta < 0 ? "faster" : "slower";
  if (unit === "feet") return delta > 0 ? "farther" : "shorter";
  if (unit === "stroke_count") return delta < 0 ? "fewer" : "more";
  if (unit === "stroke_cycles_per_minute" || unit === "kicks_per_minute") {
    return delta > 0 ? "faster" : "slower";
  }
  return delta > 0 ? "higher" : "lower";
}

function formatDeltaNumber(value: number): string {
  // Measurement values arrive as strings ("0.82", "7"). Keep significant
  // trailing decimals when they're present (0.06), drop a lonely ".00".
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2).replace(/\.?0+$/, "");
}

// ── Component history lookup ──────────────────────────────────────────────

// Builds a Map<componentSlug, ProgressRatingPoint[]> by filtering the
// swimmer's full skill-progress list. Start-component skills show up in
// `progress.skills[]` with their full history (measurement values on each
// point), so no new query is needed.
//
// Takes a structural subset of SkillProgress so callers can slice the
// response to just the fields they thread through — most of SkillProgress
// (category, type, ratedPerSide, …) is irrelevant here.
export function startComponentHistoryMap(
  skills: Array<{ slug: string; history: ProgressRatingPoint[] }>,
  components: StartComponentProgress[],
): Map<string, ProgressRatingPoint[]> {
  const slugs = new Set(components.map((component) => component.slug));
  const map = new Map<string, ProgressRatingPoint[]>();
  for (const skill of skills) {
    if (!slugs.has(skill.slug)) continue;
    map.set(skill.slug, skill.history);
  }
  return map;
}

// First measurement (chronologically earliest with a value) for a
// component. Ratings arrive newest-first from the API so we walk from the
// back of the array.
export function firstMeasurement(history: ProgressRatingPoint[]): ProgressRatingPoint | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const point = history[index];
    if (!point) continue;
    if (point.measurementValue !== null && point.measurementUnit !== null) return point;
  }
  return null;
}

export function latestMeasurement(history: ProgressRatingPoint[]): ProgressRatingPoint | null {
  for (const point of history) {
    if (point.measurementValue !== null && point.measurementUnit !== null) return point;
  }
  return null;
}

// ── Session grid ──────────────────────────────────────────────────────────

// Union of all session dates across a start's components' histories,
// sorted newest-first and capped at `maxSessions`. The grid draws columns
// right-to-left in chronological order (oldest left, newest right) so the
// caller reverses this list when rendering.
export function recentSessionDatesForStart(
  components: StartComponentProgress[],
  historyMap: Map<string, ProgressRatingPoint[]>,
  maxSessions: number = 6,
): string[] {
  const dates = new Set<string>();
  for (const component of components) {
    const history = historyMap.get(component.slug) ?? [];
    for (const point of history) {
      dates.add(point.sessionDate);
    }
  }
  return Array.from(dates)
    .sort((left, right) => (left < right ? 1 : left > right ? -1 : 0))
    .slice(0, maxSessions);
}

export interface SessionCell {
  grade: 1 | 2 | 3 | 4 | 5 | null;
  notLegal: boolean;
  noConcept: boolean;
}

// componentSlug → sessionDate → cell. Missing entries mean the component
// wasn't graded on that date — the grid draws a dashed empty cell.
export function buildSessionGridLookup(
  components: StartComponentProgress[],
  historyMap: Map<string, ProgressRatingPoint[]>,
): Map<string, Map<string, SessionCell>> {
  const lookup = new Map<string, Map<string, SessionCell>>();
  for (const component of components) {
    const perDate = new Map<string, SessionCell>();
    const history = historyMap.get(component.slug) ?? [];
    for (const point of history) {
      // If a component was rated twice on the same session date (correction
      // + original), the newest-first ordering means the first hit is the
      // effective rating. Skip subsequent duplicates.
      if (perDate.has(point.sessionDate)) continue;
      const grade: 1 | 2 | 3 | 4 | 5 | null =
        point.grade === 1 || point.grade === 2 || point.grade === 3 || point.grade === 4 || point.grade === 5
          ? point.grade
          : null;
      perDate.set(point.sessionDate, {
        grade,
        notLegal: point.notLegal,
        noConcept: point.noConcept,
      });
    }
    lookup.set(component.slug, perDate);
  }
  return lookup;
}

// ── Ramp colors ───────────────────────────────────────────────────────────

// Per-level background and foreground colors for ramped surfaces (dive dots,
// grid cells). Derived from the accent token so the component inherits the
// theme without hard-coding hex values. Opacity ramps from a light wash at
// level 1 to full accent at level 5; text flips to on-accent at the darker
// end so it stays readable against the fill.
export interface LevelRampColor {
  background: string;
  color: string;
}

export function levelRampColor(level: 1 | 2 | 3 | 4 | 5 | null): LevelRampColor {
  if (level === null) {
    return { background: "transparent", color: "var(--color-text-secondary)" };
  }
  const mix: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 18, 2: 32, 3: 55, 4: 78, 5: 100 };
  const share = mix[level];
  const background = share === 100
    ? "var(--color-accent)"
    : `color-mix(in oklab, var(--color-accent) ${share}%, var(--color-surface-soft))`;
  const color = share >= 70 ? "var(--color-on-accent)" : "var(--color-text)";
  return { background, color };
}

// ── Unit shorthand ────────────────────────────────────────────────────────

// Short unit label for pool-deck readability. Reused by the stat tiles and
// the distance line label.
export function shortUnit(unit: MeasurementUnit | null): string {
  if (unit === null) return "";
  switch (unit) {
    case "seconds":
      return "s";
    case "feet":
      return "ft";
    case "stroke_count":
      return "strokes";
    case "stroke_cycles_per_minute":
      return "spm";
    case "kicks_per_minute":
      return "kpm";
  }
}

// ── Date formatting ──────────────────────────────────────────────────────

// Short "Oct 25" header used by the session grid. Full year is omitted so
// the 34-px columns don't overflow at phone width.
export function formatShortSessionDate(sessionDate: string): string {
  const parts = sessionDate.split("-").map(Number);
  const year = parts[0];
  const month = parts[1];
  const day = parts[2];
  if (year === undefined || month === undefined || day === undefined) return sessionDate;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/Los_Angeles",
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}
