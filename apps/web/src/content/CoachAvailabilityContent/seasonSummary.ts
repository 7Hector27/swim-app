import type { SeasonWithIsCurrent } from "@swim-app/shared";

import { formatMonthDay } from "./availabilityFormat";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const WEEKDAY_SET = new Set([1, 2, 3, 4, 5]);
const WEEKEND_SET = new Set([6, 7]);

export function time12(time: string): string {
  const [hoursStr, minutes] = time.split(":") as [string, string];
  const hours = Number(hoursStr);
  const period = hours >= 12 ? "pm" : "am";
  const display = hours % 12 === 0 ? 12 : hours % 12;
  return `${display}:${minutes} ${period}`;
}

function dayLabel(day: number): string {
  return DAY_LABELS[day - 1] ?? "";
}

// "Mon to Fri" when 3+ contiguous days; "Sat, Sun" or "Mon, Wed, Fri"
// otherwise. Keeping the cutoff at 3 keeps a 2-day run like Sat/Sun as a
// natural "Sat, Sun" instead of the awkward "Sat to Sun" phrasing.
function formatDayGroup(days: readonly number[]): string {
  const sorted = [...days].sort((a, b) => a - b);
  if (sorted.length === 0) return "";
  if (sorted.length === 1) return dayLabel(sorted[0]!);
  const isContiguous = sorted.every(
    (day, index) => index === 0 || day === sorted[index - 1]! + 1,
  );
  if (isContiguous && sorted.length >= 3) {
    return `${dayLabel(sorted[0]!)} to ${dayLabel(sorted[sorted.length - 1]!)}`;
  }
  return sorted.map(dayLabel).join(", ");
}

function hoursLine(
  label: "Weekdays" | "Weekends",
  days: readonly number[],
  start: string | null,
  end: string | null,
): string {
  if (days.length === 0 || start === null || end === null) {
    return `${label}: off`;
  }
  return `${label} (${formatDayGroup(days)}): ${time12(start)} to ${time12(end)}`;
}

// "November · Nov 1 to Nov 30". Falls back to "from <start>" when the
// season has no usable end date (defensive: the schema requires one,
// but a missing or malformed string shouldn't crash the row).
export function formatSeasonTitle(season: SeasonWithIsCurrent): string {
  const start = formatMonthDay(season.startDate);
  const end = formatMonthDay(season.endDate);
  if (end === "") return `${season.name} · from ${start}`;
  return `${season.name} · ${start} to ${end}`;
}

export function formatWeekdayLine(season: SeasonWithIsCurrent): string {
  const days = season.teachesDays.filter((day) => WEEKDAY_SET.has(day));
  return hoursLine("Weekdays", days, season.weekdayStartTime, season.weekdayEndTime);
}

export function formatWeekendLine(season: SeasonWithIsCurrent): string {
  const days = season.teachesDays.filter((day) => WEEKEND_SET.has(day));
  return hoursLine("Weekends", days, season.weekendStartTime, season.weekendEndTime);
}
