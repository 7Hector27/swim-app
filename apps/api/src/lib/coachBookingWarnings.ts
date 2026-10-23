import type { CoachBookingWarnings } from "@swim-app/shared";
import { effectiveHours } from "./effectiveHours";
import type { availabilityConfig, blockedTimes, travelBufferOverrides } from "../db/schema";
import type { mapOverrideRow, mapSeasonRow } from "./availabilityMappers";

export interface ComputeCoachBookingWarningsInput {
  startsAt: Date;
  durationMinutes: 30 | 45 | 60;
  locationId: string;
  laDateStr: string;
  nowUtc: Date;
  config: typeof availabilityConfig.$inferSelect;
  seasons: ReturnType<typeof mapSeasonRow>[];
  overrides: ReturnType<typeof mapOverrideRow>[];
  blocked: (typeof blockedTimes.$inferSelect)[];
  buffers: (typeof travelBufferOverrides.$inferSelect)[];
  existingLessons: Array<{ startsAt: Date; durationMinutes: number; locationId: string }>;
}

const DEFAULT_BUFFER_MINUTES = 30;

// Pure server-side computation of the ADR 029 coach-booking warnings. Does
// NOT compute direct time overlap — that's enforced inside the booking
// transaction under the advisory day lock (data can change between warning
// computation and insert).
//
// The 16-hour notice window (bookingMinAdvanceHours) is a parent-only rule
// and is intentionally omitted here. start_in_past is a hard reject in the
// route handler, not a warning.
export function computeCoachBookingWarnings(
  input: ComputeCoachBookingWarningsInput,
): CoachBookingWarnings {
  const {
    startsAt,
    durationMinutes,
    locationId,
    laDateStr,
    nowUtc,
    config,
    seasons,
    overrides,
    blocked,
    buffers,
    existingLessons,
  } = input;

  const startMs = startsAt.getTime();
  const endMs = startMs + durationMinutes * 60_000;
  const nowMs = nowUtc.getTime();

  // outsideHours: no teaching window on this LA day, OR the slot's LA
  // wall-clock range doesn't fit entirely inside one of the day's windows.
  const hoursWindows = effectiveHours(laDateStr, seasons, overrides, {
    defaultTeachesDays: config.defaultTeachesDays,
    defaultStartTime: config.defaultStartTime,
    defaultEndTime: config.defaultEndTime,
  });
  let outsideHours = false;
  if (hoursWindows.length === 0) {
    outsideHours = true;
  } else {
    const laTimeParts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(startsAt);
    const hour = laTimeParts.find((p) => p.type === "hour")?.value ?? "00";
    const minute = laTimeParts.find((p) => p.type === "minute")?.value ?? "00";
    const startMinutes = parseInt(hour, 10) * 60 + parseInt(minute, 10);
    const endMinutes = startMinutes + durationMinutes;
    outsideHours = !hoursWindows.some((win) => {
      const [startH, startM] = win.start.split(":").map((n) => parseInt(n, 10));
      const [endH, endM] = win.end.split(":").map((n) => parseInt(n, 10));
      const winStart = (startH ?? 0) * 60 + (startM ?? 0);
      const winEnd = (endH ?? 0) * 60 + (endM ?? 0);
      return startMinutes >= winStart && endMinutes <= winEnd;
    });
  }

  // maxAdvanceExceeded: start is further out than bookingMaxAdvanceWeeks.
  const maxAdvanceMs = nowMs + config.bookingMaxAdvanceWeeks * 7 * 24 * 60 * 60 * 1000;
  const maxAdvanceExceeded = startMs > maxAdvanceMs;

  // travelBufferViolated: another lesson at a different pool is within its
  // configured travel-buffer-minutes window of this slot's start or end.
  const bufferMinutes = (from: string, to: string): number => {
    if (from === to) return 0;
    const override = buffers.find((row) => row.fromLocationId === from && row.toLocationId === to);
    return override?.bufferMinutes ?? DEFAULT_BUFFER_MINUTES;
  };
  const travelBufferViolated = existingLessons.some((row) => {
    if (row.locationId === locationId) return false;
    const existingStart = row.startsAt.getTime();
    const existingEnd = existingStart + row.durationMinutes * 60_000;
    const bufAfterMs = bufferMinutes(row.locationId, locationId) * 60_000;
    const bufBeforeMs = bufferMinutes(locationId, row.locationId) * 60_000;
    // Buffer-after-existing collides with the new slot start.
    if (startMs < existingEnd + bufAfterMs && startMs >= existingEnd) return true;
    // Buffer-before-existing collides with the new slot end.
    if (endMs > existingStart - bufBeforeMs && endMs <= existingStart) return true;
    return false;
  });

  // dailyCapExceeded: existing lessons' minutes on this LA day + this one
  // exceed maxDailyLessonMinutes.
  const laDayMinutes = existingLessons
    .filter((row) => {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Los_Angeles",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(row.startsAt);
      const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
      return `${get("year")}-${get("month")}-${get("day")}` === laDateStr;
    })
    .reduce((sum, row) => sum + row.durationMinutes, 0);
  const dailyCapExceeded = laDayMinutes + durationMinutes > config.maxDailyLessonMinutes;

  // blockedTimeOverlap: slot time range overlaps any blocked_times row.
  const blockedTimeOverlap = blocked.some((row) => {
    const bStart = row.startsAt.getTime();
    const bEnd = row.endsAt.getTime();
    return startMs < bEnd && bStart < endMs;
  });

  return {
    outsideHours,
    maxAdvanceExceeded,
    travelBufferViolated,
    dailyCapExceeded,
    blockedTimeOverlap,
  };
}
