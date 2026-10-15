import type { SwimStroke } from "../schemas/meets";

export type ValidEventStroke = SwimStroke;

// Standard competitive swimming event distances by stroke.
// IM is only valid at 100, 200, and 400 yards/meters.
const FREE_DISTANCES = [25, 50, 100, 200, 400, 500, 800, 1000, 1500, 1650] as const;
const BACK_DISTANCES = [25, 50, 100, 200] as const;
const BREAST_DISTANCES = [25, 50, 100, 200] as const;
const FLY_DISTANCES = [25, 50, 100, 200] as const;
const IM_DISTANCES = [100, 200, 400] as const;

export const VALID_EVENTS: Record<ValidEventStroke, readonly number[]> = {
  free: FREE_DISTANCES,
  back: BACK_DISTANCES,
  breast: BREAST_DISTANCES,
  fly: FLY_DISTANCES,
  im: IM_DISTANCES,
};

export function isValidEvent(distance: number, stroke: string): boolean {
  const distances = VALID_EVENTS[stroke as ValidEventStroke];
  if (!distances) return false;
  return (distances as readonly number[]).includes(distance);
}
