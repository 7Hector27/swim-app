import type {
  BatchPatternPair,
  BatchPickState,
  LessonDurationMinutes,
} from "@swim-app/shared";

export type BookingMode = "single" | "multiple" | "recurring";

// A single pick in multiple mode. Each pick carries its own length AND its
// own swimmer set (ADR 030 phase 2) so a batch can interleave different kids
// across picks. Recurring mode uses the equivalent shape via BatchPatternPair.
export interface MultiplePick {
  startsAt: string;
  durationMinutes: LessonDurationMinutes;
  swimmerIds: string[];
}

export function pickReasonCopy(state: BatchPickState): string {
  switch (state) {
    case "available":
      return "";
    case "unavailable":
      return "Time no longer open";
    case "too_soon":
      return "Less than 16 hours away";
    case "past":
      return "In the past";
    case "not_open_yet":
      return "Beyond booking window";
    case "outside_hours":
      return "Outside teaching hours";
    case "blocked_time":
      return "Jason is unavailable";
    case "day_closed":
      return "That day is closed";
    case "conflicts_batch":
      return "Overlaps another pick";
  }
}

// Format "Wed, Nov 4 · 4:30 PM" in LA.
export function formatLaDisplay(startsAtIso: string): string {
  const date = new Date(startsAtIso);
  const dayPart = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
  const timePart = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
  return `${dayPart} \u00b7 ${timePart}`;
}

export function formatLaTime(startsAtIso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(startsAtIso));
}

const WEEKDAY_SHORT: Record<number, string> = {
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
  6: "Sat",
  7: "Sun",
};

export function formatPatternPair(pair: BatchPatternPair): string {
  const [hour = 0, minute = 0] = pair.timeOfDay.split(":").map(Number);
  const meridiem = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  const displayMinute = String(minute).padStart(2, "0");
  return `${WEEKDAY_SHORT[pair.weekday]} ${displayHour}:${displayMinute} ${meridiem} \u00b7 ${pair.durationMinutes} min`;
}

// Build the HH:MM local time (America/Los_Angeles) component for a UTC ISO
// datetime. Used when a parent taps a slot in Recurring mode so the pattern
// stores the LA wall-clock time, not the UTC-shifted one.
export function laTimeOfDay(startsAtIso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date(startsAtIso))
    .replace(/^24:/, "00:");
}

// ISO weekday (1=Mon … 7=Sun) in LA for a UTC ISO datetime.
export function laIsoWeekday(startsAtIso: string): number {
  const laDayStr = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "short",
  }).format(new Date(startsAtIso));
  const map: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };
  return map[laDayStr] ?? 1;
}

// Convert an LA-local naive "YYYY-MM-DDTHH:MM:SS" to a UTC ISO string. Uses
// Intl to compute the LA offset at that moment so DST is handled correctly.
export function laLocalToUtcIso(laLocalNaive: string): string {
  const [datePart = "", timePart = ""] = laLocalNaive.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute, second = 0] = timePart.split(":").map(Number);
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined
  ) {
    return new Date(laLocalNaive).toISOString();
  }
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  const offsetMinutes = laOffsetMinutes(new Date(utcGuess));
  return new Date(utcGuess - offsetMinutes * 60_000).toISOString();
}

function laOffsetMinutes(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  const laUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") === 24 ? 0 : get("hour"),
    get("minute"),
    get("second"),
  );
  return Math.round((laUtc - date.getTime()) / 60_000);
}

// Expand a (pattern, startDate, weeks) tuple into { startsAt, durationMinutes }
// entries in week-then-pair order. Each entry inherits its length from the
// pattern pair, so a mixed-length pattern expands into a mixed-length series.
// Used by the UI to generate "planned" slot markers; the server runs the same
// expansion for the preview + submit.
export function expandRecurring(input: {
  startDate: string;
  pattern: BatchPatternPair[];
  weeks: number;
}): PickWithDuration[] {
  const result: PickWithDuration[] = [];
  const startIsoWeekday = isoWeekdayForLaDate(input.startDate);
  for (let weekIndex = 0; weekIndex < input.weeks; weekIndex++) {
    for (const pair of input.pattern) {
      const firstWeekOffset = (pair.weekday - startIsoWeekday + 7) % 7;
      const totalDayOffset = weekIndex * 7 + firstWeekOffset;
      const dateStr = addDaysToLaDate(input.startDate, totalDayOffset);
      result.push({
        startsAt: laLocalToUtcIso(`${dateStr}T${pair.timeOfDay}:00`),
        durationMinutes: pair.durationMinutes,
      });
    }
  }
  return result;
}

function isoWeekdayForLaDate(dateStr: string): number {
  const [year, month, day] = dateStr.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) return 1;
  const utc = new Date(Date.UTC(year, month - 1, day));
  const jsDow = utc.getUTCDay();
  return jsDow === 0 ? 7 : jsDow;
}

function daysBetweenLaDates(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  if (
    fy === undefined || fm === undefined || fd === undefined ||
    ty === undefined || tm === undefined || td === undefined
  ) {
    return 0;
  }
  const fromMs = Date.UTC(fy, fm - 1, fd);
  const toMs = Date.UTC(ty, tm - 1, td);
  return Math.round((toMs - fromMs) / (24 * 60 * 60 * 1000));
}

// Largest number of weeks whose pattern slots stay inside the booking window.
// Mirrors the server rule: a slot at `startDate + firstWeekOffset + w*7 days`
// is bookable iff that LA date ≤ `maxAdvanceDateLA`. Also capped by
// `maxLessons / pattern.length` to avoid building a batch over the lesson cap.
// Returns at least 1 so the stepper always has a usable value — the planned
// list is filtered to drop any slot that still ends up outside the window.
export function maxRecurringWeeksInWindow(input: {
  pattern: BatchPatternPair[];
  startDate: string;
  maxAdvanceDateLA: string;
  maxLessons: number;
}): number {
  const { pattern, startDate, maxAdvanceDateLA, maxLessons } = input;
  if (pattern.length === 0) return maxLessons;
  const startIsoWeekday = isoWeekdayForLaDate(startDate);
  let maxFirstWeekOffset = 0;
  for (const pair of pattern) {
    const offset = (pair.weekday - startIsoWeekday + 7) % 7;
    if (offset > maxFirstWeekOffset) maxFirstWeekOffset = offset;
  }
  const daysDiff = daysBetweenLaDates(startDate, maxAdvanceDateLA);
  const weeksFromCap = Math.max(1, Math.floor(maxLessons / pattern.length));
  if (daysDiff < maxFirstWeekOffset) return 1;
  const weeksFromWindow = Math.floor((daysDiff - maxFirstWeekOffset) / 7) + 1;
  return Math.max(1, Math.min(weeksFromCap, weeksFromWindow));
}

function addDaysToLaDate(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) return dateStr;
  const base = new Date(Date.UTC(year, month - 1, day));
  base.setUTCDate(base.getUTCDate() + days);
  const yr = base.getUTCFullYear();
  const mo = String(base.getUTCMonth() + 1).padStart(2, "0");
  const dy = String(base.getUTCDate()).padStart(2, "0");
  return `${yr}-${mo}-${dy}`;
}

export function todayLaDateStr(): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// LA date (YYYY-MM-DD) for a UTC ISO datetime.
export function laDateFromIso(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// ── Pick-aware helpers ──────────────────────────────────────────────────────

// Each pick has its own length, so the span and overlap helpers compute
// per-pick extents instead of applying one shared duration across them.
export interface PickWithDuration {
  startsAt: string;
  durationMinutes: LessonDurationMinutes;
}

// Does the slot start inside any pick's full duration span? A 45-min pick at
// 4:00 PM covers the 4:00, 4:15, and 4:30 slots.
export function isWithinAnyPickSpan(
  slotIso: string,
  picks: readonly PickWithDuration[],
): boolean {
  const slotMs = new Date(slotIso).getTime();
  for (const pick of picks) {
    const pMs = new Date(pick.startsAt).getTime();
    if (slotMs >= pMs && slotMs < pMs + pick.durationMinutes * 60_000) return true;
  }
  return false;
}

// Would a lesson of `slotDurationMinutes` starting at `slotIso` overlap any
// existing pick? Each pick contributes its own span. Includes the pick-head
// case (slot == pick); callers filter via isWithinAnyPickSpan.
export function doesSlotOverlapAnyPick(
  slotIso: string,
  picks: readonly PickWithDuration[],
  slotDurationMinutes: number,
): boolean {
  const slotMs = new Date(slotIso).getTime();
  const slotEnd = slotMs + slotDurationMinutes * 60_000;
  for (const pick of picks) {
    const pMs = new Date(pick.startsAt).getTime();
    const pEnd = pMs + pick.durationMinutes * 60_000;
    if (slotMs < pEnd && slotEnd > pMs) return true;
  }
  return false;
}

// Total minutes already booked by picks on each LA calendar date.
export function dailyPickMinutes(
  picks: readonly PickWithDuration[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const pick of picks) {
    const date = laDateFromIso(pick.startsAt);
    map.set(date, (map.get(date) ?? 0) + pick.durationMinutes);
  }
  return map;
}

// Would adding a `slotDurationMinutes` lesson at `slotIso` push its LA day
// past the daily cap? Each existing pick on that day contributes its own
// length to the running total.
export function wouldExceedDailyCap(
  slotIso: string,
  picks: readonly PickWithDuration[],
  slotDurationMinutes: number,
  maxDailyLessonMinutes: number,
): boolean {
  const slotDate = laDateFromIso(slotIso);
  let existing = 0;
  for (const pick of picks) {
    if (laDateFromIso(pick.startsAt) === slotDate) existing += pick.durationMinutes;
  }
  return existing + slotDurationMinutes > maxDailyLessonMinutes;
}

// Find which pick's span contains the given slot. Used when the parent taps
// a within-span cell to remove the pick it belongs to.
export function findPickContainingSlot(
  slotIso: string,
  picks: readonly PickWithDuration[],
): PickWithDuration | null {
  const slotMs = new Date(slotIso).getTime();
  for (const pick of picks) {
    const pMs = new Date(pick.startsAt).getTime();
    if (slotMs >= pMs && slotMs < pMs + pick.durationMinutes * 60_000) return pick;
  }
  return null;
}
