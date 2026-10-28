// Pure urgency helpers for coach notifications. See ADR 031.
//
// Two distinct concepts, kept separate so the UI accent and the lock-screen
// bypass evolve independently:
//
//   - `urgency` ('urgent' | 'standard'): server-computed from the affected
//     lesson's `starts_at`. 'urgent' when the lesson is before midnight
//     tomorrow in LA (today or tomorrow). Drives the Web Push `urgency`
//     header and the in-app accent.
//
//   - immediate delivery: `starts_at < now() + 12 hours`. ONLY alerts
//     within that window bypass quiet hours. Computed at send time so a
//     reschedule can be re-evaluated if the sender was delayed.
//
// The 12-hour window is strictly narrower than the today-or-tomorrow
// window: an urgent-flagged alert for a 4 PM lesson tomorrow still holds
// under quiet hours (Jason does not need a 2 AM buzz for it), but renders
// with the urgent accent in the UI.

const LA_TZ = "America/Los_Angeles";

// Returns the LA calendar date (ymd struct) for a given UTC instant.
function laYmd(now: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: LA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  const day = Number(parts.find((p) => p.type === "day")?.value);
  return { year, month, day };
}

// 'urgent' when `startsAt` is before midnight day-after-tomorrow in LA
// (today or tomorrow by LA calendar). Server-computed at enqueue time.
export function computeUrgency(startsAt: Date, now: Date = new Date()): "standard" | "urgent" {
  const today = laYmd(now);
  // laMidnightUtc handles month/day overflow via Date.UTC (e.g. day=33
  // rolls to the next month cleanly), so adding 2 to the day field is safe
  // without re-normalizing via laYmd.
  const midnightDayAfterTomorrowUtc = laMidnightUtc(today.year, today.month, today.day + 2);
  return startsAt.getTime() < midnightDayAfterTomorrowUtc.getTime() ? "urgent" : "standard";
}

// Returns the UTC Date corresponding to LA midnight (00:00) on the given
// local date. Handles DST by probing the actual offset at that date.
function laMidnightUtc(year: number, month: number, day: number): Date {
  // Treat the local wall time as if UTC, then shift by LA's offset at that
  // instant. We don't own a tzdata lib — use Intl to read the LA offset.
  const guess = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  // Minutes LA is behind UTC at `guess`.
  const offsetMinutes = laOffsetMinutes(guess);
  // We treated the wall time as UTC; shift forward by the offset so that
  // the returned UTC instant corresponds to the LA wall time.
  return new Date(guess.getTime() + offsetMinutes * 60 * 1000);
}

// LA's offset from UTC in minutes at a given instant. Positive when LA is
// behind UTC (always true in practice: PST=+480, PDT=+420).
function laOffsetMinutes(instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: LA_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "longOffset",
  }).formatToParts(instant);
  const tzName = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  // Format is "GMT-07:00" or "GMT-08:00".
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(tzName);
  if (!match) return 480;
  const sign = match[1] === "-" ? 1 : -1;
  const hh = Number(match[2] ?? 0);
  const mm = Number(match[3] ?? 0);
  return sign * (hh * 60 + mm);
}

// True iff `startsAt` is strictly less than `now + 12 hours`. The lock-
// screen bypass gate. Only alerts within 12 hours bypass quiet hours.
export function shouldBypassQuietHours(
  startsAt: Date | null,
  urgency: "standard" | "urgent",
  now: Date = new Date(),
): boolean {
  // calendar_disconnected and daily_summary have no lesson. Use `urgency`
  // as the fallback — calendar_disconnected is always urgent and bypasses;
  // daily_summary is always standard and does not.
  if (startsAt === null) return urgency === "urgent";
  const twelveHoursMs = 12 * 60 * 60 * 1000;
  return startsAt.getTime() < now.getTime() + twelveHoursMs;
}
