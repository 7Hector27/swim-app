import type { Club, ParentSwimmer } from "@swim-app/shared";

const LA = "America/Los_Angeles";

export function swimmerClubName(swimmer: ParentSwimmer, clubs: Club[]): string | null {
  const first = swimmer.clubs[0];
  if (!first) return null;
  if (first.otherClubName !== null) return first.otherClubName;
  if (first.clubId !== null) {
    const match = clubs.find((club) => club.id === first.clubId);
    return match ? match.name : null;
  }
  return null;
}

// LA-timezone weekday + time, e.g. "Thursday at 4:30 PM" (long) or
// "Thu at 4:30 PM" (short). Used by the page header and swimmer cards.
// Deterministic: locale + timeZone are explicit so server and client render
// the same string for the same input.
export function formatLessonDayTime(
  startsAtIso: string,
  options: { weekday: "long" | "short" },
): string {
  const date = new Date(startsAtIso);
  const day = new Intl.DateTimeFormat("en-US", { timeZone: LA, weekday: options.weekday }).format(
    date,
  );
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: LA,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
  return `${day} at ${time}`;
}

// Return the LA calendar day for a given instant as YYYY-MM-DD. Using LA
// (not UTC) means an evaluation logged on, say, Oct 15 locally still reads as
// "today" when the parent opens the dashboard before midnight Pacific, and
// then as "yesterday" after midnight Pacific, independent of the viewer's
// own locale.
function laDate(instant: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: LA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day") };
}

// `now` is passed in explicitly so the helper stays deterministic across the
// server render; callers typically pass `new Date()` at request time. The
// "today" boundary is Los Angeles midnight — session dates are LA calendar
// days (YYYY-MM-DD), so comparing in LA avoids flipping across UTC midnight.
export function formatRelativeDay(sessionDate: string, now: Date): string {
  const [year, month, day] = sessionDate.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) return sessionDate;
  const sessionUtcMs = Date.UTC(year, month - 1, day);
  const laNow = laDate(now);
  const nowUtcMs = Date.UTC(laNow.year, laNow.month - 1, laNow.day);
  const diffDays = Math.round((nowUtcMs - sessionUtcMs) / 86_400_000);
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays > 1 && diffDays < 7) return `${diffDays} days ago`;
  if (diffDays >= 7 && diffDays < 14) return "last week";
  if (diffDays >= 14 && diffDays < 60) return `${Math.round(diffDays / 7)} weeks ago`;
  const sessionDateObj = new Date(sessionUtcMs);
  const sameYear = sessionDateObj.getUTCFullYear() === laNow.year;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(sessionDateObj);
}
