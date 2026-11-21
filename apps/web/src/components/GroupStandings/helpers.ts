// Pure math + lane-shape helpers for WhereSheStands. Kept outside the
// component so the track positioning + aria-label math can be exercised
// without rendering.

export interface Lane {
  slug: string;
  name: string;
  firstAverage: number | null;
  firstAssessedCount: number;
  currentAverage: number | null;
  currentAssessedCount: number;
  totalCount: number;
}

// Rating-scale endpoint + midpoint labels, surfaced above the track in
// the header row. Lifted into a constant so tests can assert the labels
// without re-deriving them.
export const SCALE_LABELS = ["1 Emerging", "3 Competent", "5 Mastery"] as const;

// Map a score average (1..5) to a track position expressed as a percentage
// of the track width. 1 → 0%, 5 → 100%; values outside 1..5 clamp.
export function averageToPct(average: number): number {
  const clamped = Math.max(1, Math.min(5, average));
  return ((clamped - 1) / 4) * 100;
}

// Two averages are considered equal when they round to the same tenth —
// radar / lane rollups are computed server-side and arrive with fp noise.
// At the "equal" threshold we draw only the dot, per the brief.
export function averagesEqual(firstAverage: number | null, currentAverage: number | null): boolean {
  if (firstAverage === null || currentAverage === null) return false;
  return Math.abs(firstAverage - currentAverage) < 0.05;
}

// A lane is rated when either the first or current snapshot had any assessed
// skills — a group with zero on both sides reads as "Not rated yet."
export function laneIsRated(lane: Lane): boolean {
  return lane.firstAssessedCount > 0 || lane.currentAssessedCount > 0;
}

// Direction of the filled stretch between first and current:
//   - "up"   → accent fill (improvement)
//   - "down" → neutral fill (regression; keep both markers visible)
//   - "flat" → no stretch (first equals current, ring collapses to dot)
//   - "none" → one of the averages is missing (skip the stretch)
export type StretchTone = "up" | "down" | "flat" | "none";

export function stretchTone(lane: Lane): StretchTone {
  if (lane.firstAverage === null || lane.currentAverage === null) return "none";
  if (averagesEqual(lane.firstAverage, lane.currentAverage)) return "flat";
  return lane.currentAverage > lane.firstAverage ? "up" : "down";
}

// Build display-ready lanes from first + latest screen-group rollups. Order
// follows the latest snapshot so a newly-rated group doesn't shuffle earlier
// rows. firstSnapshot may be empty — every lane's firstAverage collapses to
// null and the row shows only the current dot.
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
      return `${lane.name}: average ${avg}, ${lane.currentAssessedCount} of ${lane.totalCount} skills rated`;
    })
    .join(". ");
}
