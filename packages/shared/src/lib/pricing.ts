import type { LessonDurationMinutes } from "../schemas/booking";
import type { PackageTier, SwimmerCount } from "../schemas/payments";

// All public amounts in integer cents. The rate card is the single source of
// truth for lesson and package pricing; API callers compute amounts via these
// functions and never trust an amount passed in by the browser.
//
// Base rate: $120/hour private. Sibling-rate ladder, per hour of one household
// (one coach, one slot, multiple kids):
//   1 swimmer → $120   (12000 cents)
//   2 swimmers → $180  (18000 cents)
//   3 swimmers → $198  (19800 cents)
//   4 swimmers → $216  (21600 cents)
//
// The only half-dollar price in the system is (3 swimmers, 45 min) = $148.50.

export const SWIMMER_COUNTS: readonly SwimmerCount[] = [1, 2, 3, 4];
export const PACKAGE_TIERS: readonly PackageTier[] = ["cannonball", "deep_end"];

const HOURLY_RATE_CENTS: Record<SwimmerCount, number> = {
  1: 12_000,
  2: 18_000,
  3: 19_800,
  4: 21_600,
};

// Package definition: hours of credit and the percentage discount applied to
// the matching hourly rate. Price = credit × (1 − discountPct/100), always an
// integer-cent value for the four supported discount × swimmer-count combos.
const PACKAGE_SPEC: Record<PackageTier, { hours: number; discountPct: number }> = {
  cannonball: { hours: 10, discountPct: 10 },
  deep_end: { hours: 20, discountPct: 20 },
};

export function hourlyRateCents(swimmerCount: SwimmerCount): number {
  return HOURLY_RATE_CENTS[swimmerCount];
}

export function priceForLesson(
  durationMinutes: LessonDurationMinutes,
  swimmerCount: SwimmerCount,
): number {
  return (hourlyRateCents(swimmerCount) * durationMinutes) / 60;
}

export interface PackagePriceResult {
  creditCents: number;
  priceCents: number;
  bonusCents: number;
}

export function packagePrice(
  tier: PackageTier,
  swimmerCount: SwimmerCount,
): PackagePriceResult {
  const spec = PACKAGE_SPEC[tier];
  const creditCents = hourlyRateCents(swimmerCount) * spec.hours;
  const priceCents = (creditCents * (100 - spec.discountPct)) / 100;
  const bonusCents = creditCents - priceCents;
  return { creditCents, priceCents, bonusCents };
}

// Floor the balance to the nearest half-hour of a 1-swimmer private lesson, so
// the balance page can say "≈ 3 hours" or "≈ 3.5 hours" rather than exposing
// the raw cents. Uses the single-swimmer private rate ($120/hr) because mixed-
// sibling bookings vary; a single conservative estimate is the honest option.
export function approximatePrivateHours(balanceCents: number): number {
  if (balanceCents <= 0) return 0;
  const halfHourCents = HOURLY_RATE_CENTS[1] / 2;
  return Math.floor(balanceCents / halfHourCents) / 2;
}
