import type { AvailabilitySeason, AvailabilityOverride, ImpactWarning } from "@swim-app/shared";
import { effectiveHours, type DefaultHours } from "./effectiveHours";
import { getDateInLA } from "./slots";

const LA_TZ = "America/Los_Angeles";

function parseHHMM(time: string): number {
  const hour = Number(time.slice(0, 2));
  const min = Number(time.slice(3, 5));
  return hour * 60 + min;
}

// Returns the LA wall-clock minutes-since-midnight for a UTC instant.
function getLaMinutes(instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: LA_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const hour = get("hour") % 24;
  return hour * 60 + get("minute");
}

// Returns the second Sunday of March for a given year, as "YYYY-03-DD".
export function dstStartDate(year: number): string {
  const march1 = new Date(Date.UTC(year, 2, 1));
  const dow = march1.getUTCDay(); // 0=Sun, 1=Mon ... 6=Sat
  const firstSundayDay = dow === 0 ? 1 : 8 - dow;
  const secondSundayDay = firstSundayDay + 7;
  return `${year}-03-${String(secondSundayDay).padStart(2, "0")}`;
}

export interface UpcomingLessonForWarning {
  id: string;
  startsAt: Date;
  durationMinutes: number;
  swimmerFirstNames: string[];
  poolName: string;
}

function lessonFitsWindows(lesson: UpcomingLessonForWarning, windows: ReturnType<typeof effectiveHours>): boolean {
  if (windows.length === 0) return false;
  const startMin = getLaMinutes(lesson.startsAt);
  const endMin = startMin + lesson.durationMinutes;
  return windows.some((window) => {
    const windowStart = parseHHMM(window.start);
    const windowEnd = parseHHMM(window.end);
    return startMin >= windowStart && endMin <= windowEnd;
  });
}

// COACH-ONLY: returned warnings carry swimmer first names and pool names from
// other households. Only call this from handlers mounted under /coach (guarded
// by `requireCoach`); never surface the result to parents or public routes.
//
// Only flags lessons that fit before the change and no longer fit after — so
// lessons outside the affected date range (where before == after) are never
// surfaced, and lessons that were already broken before the change are ignored.
export function computeImpactWarnings(
  lessons: UpcomingLessonForWarning[],
  seasonsBefore: AvailabilitySeason[],
  overridesBefore: AvailabilityOverride[],
  seasonsAfter: AvailabilitySeason[],
  overridesAfter: AvailabilityOverride[],
  defaults: DefaultHours | null = null,
): ImpactWarning[] {
  const warnings: ImpactWarning[] = [];
  for (const lesson of lessons) {
    const laDate = getDateInLA(lesson.startsAt);
    const windowsBefore = effectiveHours(laDate, seasonsBefore, overridesBefore, defaults);
    const windowsAfter = effectiveHours(laDate, seasonsAfter, overridesAfter, defaults);
    if (!lessonFitsWindows(lesson, windowsBefore)) continue;
    if (lessonFitsWindows(lesson, windowsAfter)) continue;
    warnings.push({
      lessonId: lesson.id,
      startsAt: lesson.startsAt.toISOString(),
      reason: windowsAfter.length === 0 ? "day_closed" : "outside_hours",
      swimmerFirstNames: lesson.swimmerFirstNames,
      poolName: lesson.poolName,
    });
  }
  return warnings;
}
