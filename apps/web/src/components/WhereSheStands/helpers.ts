// Pure math + lane-shape helpers for WhereSheStands, kept outside the
// component so the viewBox math can be unit-tested without rendering.

export interface Lane {
  slug: string;
  name: string;
  firstAverage: number | null;
  firstAssessedCount: number;
  currentAverage: number | null;
  currentAssessedCount: number;
  totalCount: number;
}

// Horizontal axis maps score 1..5 to the pixel band [TRACK_X_START, TRACK_X_END]
// inside the 520-unit viewBox. Values outside 1..5 clamp at the edges so a
// future bad average can't push a dot off the chart.
export const TRACK_X_START = 150;
export const TRACK_X_END = 430;
export const SCALE_X_POSITIONS = [150, 220, 290, 360, 430] as const;
export const RIGHT_LABEL_X = 520;

// y position tuning: scale header at y=14 (11px font), first row baseline at
// y=44, then +30 per row. Track lines sit 4 units above the text baseline so
// text and dot read as aligned. Keep in lockstep with WhereSheStands.tsx.
export const HEADER_Y = 14;
export const FIRST_ROW_Y = 44;
export const ROW_STEP = 30;
export const BOTTOM_PAD = 12;

export function laneTextY(index: number): number {
  return FIRST_ROW_Y + index * ROW_STEP;
}

export function laneTrackY(index: number): number {
  return laneTextY(index) - 4;
}

export function totalViewHeight(laneCount: number): number {
  if (laneCount === 0) return HEADER_Y + BOTTOM_PAD;
  return laneTextY(laneCount - 1) + BOTTOM_PAD;
}

// Position the ring (first) or dot (now) along the 1..5 track. An average of
// 1 sits at TRACK_X_START; 5 sits at TRACK_X_END. Values outside 1..5 clamp.
export function averageToX(average: number): number {
  const clamped = Math.max(1, Math.min(5, average));
  return TRACK_X_START + ((clamped - 1) / 4) * (TRACK_X_END - TRACK_X_START);
}

// A lane is rated when either the first or current snapshot had any assessed
// skills — a group with zero on both sides reads as "Not rated yet."
export function laneIsRated(lane: Lane): boolean {
  return lane.firstAssessedCount > 0 || lane.currentAssessedCount > 0;
}

// Build display-ready lanes from first + latest screen-group rollups. Order
// follows the latest snapshot so a newly-rated group doesn't shuffle earlier
// rows. When the swimmer has only one evaluation, firstSnapshot is empty —
// the ring collapses to null and only the current dot renders.
export function buildLanes(
  firstSnapshot: ReadonlyArray<{
    screenSlug: string;
    name: string;
    average: number | null;
    assessedCount: number;
    totalCount: number;
  }>,
  latestSnapshot: ReadonlyArray<{
    screenSlug: string;
    name: string;
    average: number | null;
    assessedCount: number;
    totalCount: number;
  }>,
): Lane[] {
  const firstBySlug = new Map(firstSnapshot.map((entry) => [entry.screenSlug, entry]));
  return latestSnapshot.map((current) => {
    const first = firstBySlug.get(current.screenSlug);
    return {
      slug: current.screenSlug,
      name: current.name,
      firstAverage: first?.average ?? null,
      firstAssessedCount: first?.assessedCount ?? 0,
      currentAverage: current.average,
      currentAssessedCount: current.assessedCount,
      totalCount: current.totalCount,
    };
  });
}

// Screen-reader sentence form: "<name>: <avg>, <n> of <total> skills rated"
// per lane; not-rated lanes drop to "<name>: not rated yet."
export function buildAriaLabel(lanes: ReadonlyArray<Lane>): string {
  return lanes
    .map((lane) => {
      if (!laneIsRated(lane)) return `${lane.name}: not rated yet`;
      const avg = lane.currentAverage !== null ? lane.currentAverage.toFixed(1) : "—";
      return `${lane.name}: ${avg}, ${lane.currentAssessedCount} of ${lane.totalCount} skills rated`;
    })
    .join(". ");
}
