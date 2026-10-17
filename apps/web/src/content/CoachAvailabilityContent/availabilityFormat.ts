import type { AvailabilitySeason } from "@swim-app/shared";

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

// "2026-10-15" -> "Oct 15". LA calendar date is already a pure date.
export function formatMonthDay(dateIso: string): string {
  const [year, month, day] = dateIso.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  }).format(date);
}

// "2026-10-15" -> "Oct 15, 2026"
export function formatMonthDayYear(dateIso: string): string {
  const [year, month, day] = dateIso.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

// Weekday short label for a YYYY-MM-DD date (LA calendar).
export function weekdayShort(dateIso: string): string {
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

export function addDaysIso(dateIso: string, offset: number): string {
  const [year, month, day] = dateIso.split("-").map(Number) as [number, number, number];
  const next = new Date(Date.UTC(year, month - 1, day + offset));
  const yyyy = next.getUTCFullYear();
  const mm = String(next.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(next.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
