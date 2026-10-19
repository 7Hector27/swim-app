import type { SeasonWithIsCurrent } from "@swim-app/shared";

export function time12(time: string): string {
  const [hoursStr, minutes] = time.split(":") as [string, string];
  const hours = Number(hoursStr);
  const period = hours >= 12 ? "pm" : "am";
  const display = hours % 12 === 0 ? 12 : hours % 12;
  return `${display}:${minutes} ${period}`;
}

export function upcomingSummary(season: SeasonWithIsCurrent): string {
  const parts: string[] = [];
  if (season.weekdayStartTime) parts.push(`${time12(season.weekdayStartTime)} weekdays`);
  if (
    season.weekendStartTime &&
    season.weekendStartTime !== season.weekdayStartTime
  ) {
    parts.push(`${time12(season.weekendStartTime)} weekends`);
  }
  const endTime = season.weekdayEndTime ?? season.weekendEndTime;
  if (endTime !== null && endTime !== undefined) {
    parts.push(`ends ${time12(endTime)}`);
  }
  return parts.join(" · ");
}
