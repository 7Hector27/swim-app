import type {
  AvailabilityConfig,
  AvailabilitySeason,
  AvailabilityOverride,
  TeachingWindow,
} from "@swim-app/shared";
import { getISODayOfWeek } from "./slots";

export type DefaultHours = Pick<
  AvailabilityConfig,
  "defaultTeachesDays" | "defaultStartTime" | "defaultEndTime"
>;

// Normalizes "HH:MM" or "HH:MM:SS" to "HH:MM".
function toHHMM(time: string): string {
  return time.slice(0, 5);
}

// Returns the active season for `date`: among rows where startDate <= date <= endDate,
// picks the one with the latest startDate (so if seasons overlap in data, the most
// recent one wins — mirrors the tiebreak behavior at the API layer).
function findActiveSeason(
  date: string,
  seasons: AvailabilitySeason[],
): AvailabilitySeason | null {
  let active: AvailabilitySeason | null = null;
  for (const season of seasons) {
    if (
      season.startDate <= date &&
      season.endDate >= date &&
      (active === null || season.startDate > active.startDate)
    ) {
      active = season;
    }
  }
  return active;
}

// Returns the override covering `date` (start_date <= date <= end_date).
// If multiple overlap, picks the one with the latest start_date (plan: overlapping
// overrides on the same range are a 422 at the API layer, so this is a tiebreak only).
function findActiveOverride(
  date: string,
  overrides: AvailabilityOverride[],
): AvailabilityOverride | null {
  let active: AvailabilityOverride | null = null;
  for (const override of overrides) {
    if (
      override.startDate <= date &&
      override.endDate >= date &&
      (active === null || override.startDate > active.startDate)
    ) {
      active = override;
    }
  }
  return active;
}

// Resolves teaching windows for a given LA calendar date.
// Precedence: one-off override → active season → default hours (when provided).
// Returns zero windows when the day is closed; one window otherwise.
export function effectiveHours(
  date: string,
  seasons: AvailabilitySeason[],
  overrides: AvailabilityOverride[],
  defaults: DefaultHours | null = null,
): TeachingWindow[] {
  const override = findActiveOverride(date, overrides);
  if (override !== null) {
    if (override.kind === "day_off") return [];
    // custom_hours: both times are non-null by DB CHECK + schema invariants.
    if (override.startTime === null || override.endTime === null) return [];
    return [{ start: toHHMM(override.startTime), end: toHHMM(override.endTime) }];
  }

  const season = findActiveSeason(date, seasons);
  if (season !== null) {
    const iso = getISODayOfWeek(date);
    if (!season.teachesDays.includes(iso)) return [];

    const isWeekend = iso === 6 || iso === 7;
    const start = isWeekend ? season.weekendStartTime : season.weekdayStartTime;
    if (start === null) return [];
    const end = isWeekend ? season.weekendEndTime : season.weekdayEndTime;
    if (end === null) return [];
    return [{ start: toHHMM(start), end: toHHMM(end) }];
  }

  if (defaults === null) return [];

  const iso = getISODayOfWeek(date);
  if (!defaults.defaultTeachesDays.includes(iso)) return [];

  return [
    { start: toHHMM(defaults.defaultStartTime), end: toHHMM(defaults.defaultEndTime) },
  ];
}
