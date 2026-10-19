import type { AvailabilitySeason, SeasonWithIsCurrent } from "@swim-app/shared";

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const WEEKDAY_SET = new Set([1, 2, 3, 4, 5]);
const WEEKEND_SET = new Set([6, 7]);

export function formatTeachesDays(days: readonly number[]): string {
  const sorted = [...days].sort((a, b) => a - b);
  if (sorted.length === 7) return "Every day";
  const isWeekdaysOnly = sorted.every((day) => WEEKDAY_SET.has(day)) && sorted.length === 5;
  if (isWeekdaysOnly) return "Weekdays";
  const isWeekendsOnly = sorted.every((day) => WEEKEND_SET.has(day)) && sorted.length === 2;
  if (isWeekendsOnly) return "Weekends";
  return sorted.map((day) => WEEKDAY_LABELS[day - 1]).join(", ");
}

// Converts "15:00" -> "3:00 pm", nullable passthrough.
export function formatTime12(time: string | null): string {
  if (time === null) return "—";
  const [hoursStr, minutesStr] = time.split(":") as [string, string];
  const hours = Number(hoursStr);
  const minutes = minutesStr;
  const period = hours >= 12 ? "pm" : "am";
  const displayHours = hours % 12 === 0 ? 12 : hours % 12;
  return `${displayHours}:${minutes} ${period}`;
}

export function isValidDateIso(dateIso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return false;
  const [year, month, day] = dateIso.split("-").map(Number) as [number, number, number];
  return month >= 1 && month <= 12 && day >= 1 && day <= 31 && year > 0;
}

// "2026-10-15" -> "Oct 15". Returns "" for empty or invalid input.
export function formatMonthDay(dateIso: string): string {
  if (!isValidDateIso(dateIso)) return "";
  const [year, month, day] = dateIso.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  }).format(date);
}

// "2026-10-15" -> "Oct 15, 2026". Returns "" for empty or invalid input.
export function formatMonthDayYear(dateIso: string): string {
  if (!isValidDateIso(dateIso)) return "";
  const [year, month, day] = dateIso.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

// Weekday short label for a YYYY-MM-DD date (LA calendar). Returns "" for invalid input.
export function weekdayShort(dateIso: string): string {
  if (!isValidDateIso(dateIso)) return "";
  const [year, month, day] = dateIso.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short" }).format(date);
}

export function dayOfMonth(dateIso: string): number {
  return Number(dateIso.slice(8, 10));
}

export function formatWindowRange(start: string, end: string): string {
  return `${formatTime12(start)} – ${formatTime12(end)}`;
}

// "2026-06-15T18:00:00-07:00" -> { date: "Jun 15", time: "6:00 pm" } in LA.
export function formatLessonLA(isoWithOffset: string): { date: string; time: string } {
  const date = new Date(isoWithOffset);
  const dateLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
  }).format(date);
  const timeLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(date)
    .toLowerCase()
    .replace(" ", " ");
  return { date: dateLabel, time: timeLabel };
}

export function joinNames(names: readonly string[]): string {
  if (names.length === 0) return "No swimmers";
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

export function seasonHasDifferentWeekendStart(season: AvailabilitySeason): boolean {
  return (
    season.weekdayStartTime !== null &&
    season.weekendStartTime !== null &&
    season.weekdayStartTime !== season.weekendStartTime
  );
}

// Marks the active season (latest startDate <= today) as isCurrent and clears
// the flag on the rest. Mirrors the server rule so optimistic updates after a
// create/patch/delete don't blank out the "Now" badge.
export function withIsCurrent(
  seasons: readonly AvailabilitySeason[],
  today: string,
): SeasonWithIsCurrent[] {
  let activeId: string | null = null;
  let activeStart = "";
  for (const season of seasons) {
    if (season.startDate <= today && season.startDate > activeStart) {
      activeStart = season.startDate;
      activeId = season.id;
    }
  }
  return seasons.map((season) => ({ ...season, isCurrent: season.id === activeId }));
}

export function addDaysIso(dateIso: string, offset: number): string {
  if (!isValidDateIso(dateIso)) return "";
  const [year, month, day] = dateIso.split("-").map(Number) as [number, number, number];
  const next = new Date(Date.UTC(year, month - 1, day + offset));
  const yyyy = next.getUTCFullYear();
  const mm = String(next.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(next.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
