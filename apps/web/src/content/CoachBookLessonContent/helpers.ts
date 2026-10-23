import { fromZonedTime } from "date-fns-tz";
import type {
  CoachBookingWarnings,
  CoachHouseholdSearchResult,
  CoachHouseholdSearchSwimmer,
  LessonLocation,
} from "@swim-app/shared";

export type BookingStep = "pickHousehold" | "pickTime" | "success";

export interface SelectedLocation {
  id: string;
  name: string;
  isHomePool: boolean;
}

// Returns the active (non-archived) swimmers from a household search result.
export function activeSwimmers(
  household: CoachHouseholdSearchResult,
): CoachHouseholdSearchSwimmer[] {
  return household.swimmers.filter((swimmer) => swimmer.archivedAt === null);
}

// Resolves the pre-filled swimmer id from a /coach/book query string
// against a loaded household. Returns an empty array when no household
// is pre-filled, no swimmer is pre-filled, the swimmer doesn't belong
// to the household, or the swimmer is archived. Called from both the
// server page (page.tsx) and the client orchestrator — this lives in a
// no-directive module so the server component can import it without
// pulling the "use client" boundary into a server render.
export function computeInitialSwimmerIds(
  household: CoachHouseholdSearchResult | null,
  prefillSwimmerId: string | undefined,
): string[] {
  if (!household || !prefillSwimmerId) return [];
  const match = activeSwimmers(household).find((swimmer) => swimmer.id === prefillSwimmerId);
  return match ? [match.id] : [];
}

// Builds a "Family" display name: prefers the owner's full name from member
// list, otherwise falls back to the stored household name.
export function familyDisplayName(household: CoachHouseholdSearchResult): string {
  const [firstMember] = household.memberFullNames;
  if (firstMember) return firstMember;
  return household.householdName;
}

// Returns the LA calendar date as YYYY-MM-DD for the current wall clock.
export function todayLA(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// Converts a (date, time) in America/Los_Angeles to a UTC ISO string via
// date-fns-tz. Replaces an earlier hand-rolled probe that added a raw +7h
// (PDT) guess to pick the DST side; on a PST↔PDT fall-back night the probe
// could land on the wrong side of the ambiguous hour and emit a UTC time
// one hour off.
//
// Fall-back ambiguity policy: the clock sees 01:00–02:00 LA twice (first as
// PDT, then as PST). `fromZonedTime` resolves this to the first occurrence
// (PDT) — this matches the coach picker's "the time I just typed" intent.
// Spring-forward gap: 02:00–03:00 LA does not exist. `fromZonedTime` maps
// those wall-clock minutes forward into PDT (the next real local instant).
// Caller input validation already restricts times to :00/:15/:30/:45 inside
// teaching hours, so the gap is practically unreachable; the mapping stays
// defined for safety.
export function laDateTimeToUtcIso(date: string, timeHHMM: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = timeHHMM.split(":").map(Number);
  if (!y || !m || !d || hh === undefined || mm === undefined) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  const wallClock = `${y}-${pad(m)}-${pad(d)}T${pad(hh)}:${pad(mm)}:00`;
  return fromZonedTime(wallClock, "America/Los_Angeles").toISOString();
}

// Human-readable LA display string, e.g. "Sat, Nov 1 at 10:30 AM".
export function formatLessonTimeDisplay(isoUtc: string): string {
  const date = new Date(isoUtc);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

export interface LocalOverlapCheck {
  overlaps: boolean;
  overlapLabel?: string;
}

// Client-side overlap check: given the household's existing lessons for the
// week (from /lessons/available-range the server already filters, but we
// also recheck against the full lesson range here) and the proposed slot,
// returns true when the time range would overlap another lesson.
export function detectLocalOverlap(args: {
  startsAtUtc: string;
  durationMinutes: 30 | 45 | 60;
  existing: Array<{ startsAtUtc: string; durationMinutes: number; locationName: string }>;
}): LocalOverlapCheck {
  const newStart = new Date(args.startsAtUtc).getTime();
  const newEnd = newStart + args.durationMinutes * 60_000;
  for (const row of args.existing) {
    const existingStart = new Date(row.startsAtUtc).getTime();
    const existingEnd = existingStart + row.durationMinutes * 60_000;
    if (newStart < existingEnd && existingStart < newEnd) {
      const whenLabel = formatLessonTimeDisplay(row.startsAtUtc);
      return {
        overlaps: true,
        overlapLabel: `Overlaps the ${whenLabel} lesson at ${row.locationName}. Pick a different time.`,
      };
    }
  }
  return { overlaps: false };
}

// Human copy for each warning. The copy renders in the warnings card above
// the summary dialog's acknowledge checkboxes and in the audit-visible list.
export const WARNING_COPY: Record<keyof CoachBookingWarnings, string> = {
  outsideHours: "Outside your teaching hours.",
  maxAdvanceExceeded: "More than 10 weeks away.",
  travelBufferViolated: "Travel buffer with another lesson is too tight.",
  dailyCapExceeded: "This day will exceed your daily lesson cap.",
  blockedTimeOverlap: "Overlaps a blocked time on your schedule.",
};

// Returns true if the warnings object has at least one TRUE flag.
export function hasAnyWarning(warnings: CoachBookingWarnings): boolean {
  return (Object.values(warnings) as boolean[]).some((flag) => flag);
}

// Returns the subset of warning keys that are TRUE.
export function activeWarningKeys(
  warnings: CoachBookingWarnings,
): Array<keyof CoachBookingWarnings> {
  return (Object.keys(warnings) as Array<keyof CoachBookingWarnings>).filter(
    (key) => warnings[key],
  );
}

// Zero-filled warnings object (used when no warnings fired).
export function emptyWarnings(): CoachBookingWarnings {
  return {
    outsideHours: false,
    maxAdvanceExceeded: false,
    travelBufferViolated: false,
    dailyCapExceeded: false,
    blockedTimeOverlap: false,
  };
}

// Builds the location options for step 2's selector. Home pool first (if the
// household has one), then every active named pool.
export function buildLocationOptions(
  household: CoachHouseholdSearchResult | null,
  namedPools: LessonLocation[],
): SelectedLocation[] {
  const options: SelectedLocation[] = [];
  if (household?.homePoolLocationId) {
    options.push({
      id: household.homePoolLocationId,
      name: "Home pool",
      isHomePool: true,
    });
  }
  for (const pool of namedPools) {
    if (!pool.isHomePool) {
      options.push({ id: pool.id, name: pool.name, isHomePool: false });
    }
  }
  return options;
}
