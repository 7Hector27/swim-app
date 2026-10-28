const LA_TZ = "America/Los_Angeles";

export function laCalendarDate(instant: Date | number): string {
  const date = typeof instant === "number" ? new Date(instant) : instant;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: LA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function isoWeekdayOfLaDate(dateStr: string): number {
  const year = Number(dateStr.slice(0, 4));
  const month = Number(dateStr.slice(5, 7));
  const day = Number(dateStr.slice(8, 10));
  const jsDay = new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
  return jsDay === 0 ? 7 : jsDay;
}

function addDaysToIsoDate(dateStr: string, days: number): string {
  const year = Number(dateStr.slice(0, 4));
  const month = Number(dateStr.slice(5, 7));
  const day = Number(dateStr.slice(8, 10));
  const base = new Date(Date.UTC(year, month - 1, day, 12));
  base.setUTCDate(base.getUTCDate() + days);
  const yy = base.getUTCFullYear();
  const mm = String(base.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(base.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

// Last bookable LA calendar date (YYYY-MM-DD). Week 1 is the Monday–Sunday
// week in America/Los_Angeles that contains `now`; the returned date is the
// Sunday of week `maxWeeks`. maxWeeks must be ≥ 1.
export function bookingWindowEnd(now: Date, maxWeeks: number): string {
  const today = laCalendarDate(now);
  const dow = isoWeekdayOfLaDate(today);
  const monday = addDaysToIsoDate(today, -(dow - 1));
  return addDaysToIsoDate(monday, maxWeeks * 7 - 1);
}

// True when `startsAt` falls on an LA calendar date after the booking window.
// Matches the server's "too_far" check across every booking entry point.
export function isAfterBookingWindow(
  startsAt: Date,
  now: Date,
  maxWeeks: number,
): boolean {
  return laCalendarDate(startsAt) > bookingWindowEnd(now, maxWeeks);
}
