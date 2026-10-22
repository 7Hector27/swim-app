import type {
  AvailabilityConfig,
  AvailabilityOverride,
  AvailabilitySeason,
  SlotState,
  SlotWithState,
} from "@swim-app/shared";
import { effectiveHours } from "./effectiveHours";

export interface SlotParams {
  date: string; // YYYY-MM-DD in America/Los_Angeles
  durationMinutes: 30 | 45 | 60;
  locationId: string;
  existingLessons: {
    startsAt: Date;
    durationMinutes: number;
    locationId: string;
  }[];
  blockedTimes: { startsAt: Date; endsAt: Date }[];
  travelBufferOverrides: { fromLocationId: string; toLocationId: string; bufferMinutes: number }[];
  config: AvailabilityConfig;
  seasons: AvailabilitySeason[];
  overrides: AvailabilityOverride[];
  gcalBusyTimes: { startsAt: Date; endsAt: Date }[]; // empty until PR 6
  nowUtc: Date;
}

export interface Slot {
  startsAt: Date;
  endsAt: Date;
}

type Interval = [number, number]; // [startMs, endMs]
const LA_TZ = "America/Los_Angeles";
const MIN_MS = 60_000;
const FIFTEEN_MS = 15 * MIN_MS;
const DEFAULT_TRAVEL_BUFFER_MINUTES = 30;

// Returns (UTC epoch ms) - (LA epoch ms) for a given instant — i.e. the LA UTC offset.
function getLaOffsetMs(date: Date): number {
  const toEpoch = (tz: string) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hour12: false,
    }).formatToParts(date);
    const get = (type: string) =>
      Number(parts.find((p) => p.type === type)?.value ?? 0);
    return Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour") % 24, // guard: some impls return 24 for midnight
      get("minute"),
      get("second"),
    );
  };
  return toEpoch("UTC") - toEpoch(LA_TZ);
}

// Converts a wall-clock date+time in America/Los_Angeles to a UTC Date.
function laToUtc(dateStr: string, timeStr: string): Date {
  const year = Number(dateStr.slice(0, 4));
  const month = Number(dateStr.slice(5, 7));
  const day = Number(dateStr.slice(8, 10));
  const hour = Number(timeStr.slice(0, 2));
  const min = Number(timeStr.slice(3, 5));

  // Initial approximation uses PDT (UTC-7); getLaOffsetMs corrects for PST/PDT.
  const approxMs = Date.UTC(year, month - 1, day, hour + 7, min);
  const offsetMs = getLaOffsetMs(new Date(approxMs));
  return new Date(Date.UTC(year, month - 1, day, hour, min) + offsetMs);
}

// Returns the YYYY-MM-DD date for a UTC instant as seen in LA.
export function getDateInLA(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: LA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// Returns ISO day-of-week (1=Mon … 7=Sun) for a YYYY-MM-DD date string.
export function getISODayOfWeek(dateStr: string): number {
  const year = Number(dateStr.slice(0, 4));
  const month = Number(dateStr.slice(5, 7));
  const day = Number(dateStr.slice(8, 10));
  // Noon UTC avoids any timezone-day-boundary issue.
  const jsDay = new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay();
  return jsDay === 0 ? 7 : jsDay;
}

function getTravelBufferMs(
  from: string,
  to: string,
  overrides: SlotParams["travelBufferOverrides"],
): number {
  if (from === to) return 0;
  const override = overrides.find(
    (o) => o.fromLocationId === from && o.toLocationId === to,
  );
  const minutes =
    override !== undefined ? override.bufferMinutes : DEFAULT_TRAVEL_BUFFER_MINUTES;
  return minutes * MIN_MS;
}

function mergeIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const first = sorted[0]!;
  const merged: Interval[] = [[first[0], first[1]]];
  for (let index = 1; index < sorted.length; index++) {
    const current = sorted[index]!;
    const last = merged[merged.length - 1]!;
    if (current[0] <= last[1]) {
      last[1] = Math.max(last[1], current[1]);
    } else {
      merged.push([current[0], current[1]]);
    }
  }
  return merged;
}

function subtractIntervals(window: Interval, forbidden: Interval[]): Interval[] {
  let remaining: Interval[] = [[window[0], window[1]]];
  for (const [fStart, fEnd] of forbidden) {
    const next: Interval[] = [];
    for (const [rStart, rEnd] of remaining) {
      if (fEnd <= rStart || fStart >= rEnd) {
        next.push([rStart, rEnd]);
      } else {
        if (fStart > rStart) next.push([rStart, fStart]);
        if (fEnd < rEnd) next.push([fEnd, rEnd]);
      }
    }
    remaining = next;
  }
  return remaining;
}

// Merge overlapping or adjacent slot windows into a minimal list.
export function mergeSlotWindows(slots: Slot[]): Slot[] {
  if (slots.length === 0) return [];
  const sorted = [...slots].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const first = sorted[0]!;
  const merged: Slot[] = [{ startsAt: first.startsAt, endsAt: first.endsAt }];
  for (let index = 1; index < sorted.length; index++) {
    const current = sorted[index]!;
    const last = merged[merged.length - 1]!;
    if (current.startsAt.getTime() <= last.endsAt.getTime()) {
      if (current.endsAt.getTime() > last.endsAt.getTime()) {
        last.endsAt = current.endsAt;
      }
    } else {
      merged.push({ startsAt: current.startsAt, endsAt: current.endsAt });
    }
  }
  return merged;
}

// Resolves the teaching windows for a date into UTC-ms intervals.
function resolveWindows(
  date: string,
  seasons: AvailabilitySeason[],
  overrides: AvailabilityOverride[],
  defaults: {
    defaultTeachesDays: number[];
    defaultStartTime: string;
    defaultEndTime: string;
  },
): Interval[] {
  return effectiveHours(date, seasons, overrides, defaults).map((window) => [
    laToUtc(date, window.start).getTime(),
    laToUtc(date, window.end).getTime(),
  ]);
}

export function computeAvailableSlots(params: SlotParams): Slot[] {
  const {
    date,
    durationMinutes,
    locationId,
    existingLessons,
    blockedTimes,
    travelBufferOverrides,
    config,
    seasons,
    overrides,
    gcalBusyTimes,
    nowUtc,
  } = params;

  const windows = resolveWindows(date, seasons, overrides, config);
  if (windows.length === 0) return [];

  // Build forbidden intervals from lessons, blocked times, and GCal.
  const forbidden: Interval[] = [];

  for (const lesson of existingLessons) {
    const lessonStart = lesson.startsAt.getTime();
    const lessonEnd = lessonStart + lesson.durationMinutes * MIN_MS;

    forbidden.push([lessonStart, lessonEnd]);

    if (lesson.locationId !== locationId) {
      // Prevent a new slot at locationId from starting before travel from lesson pool arrives.
      const bufAfterMs = getTravelBufferMs(lesson.locationId, locationId, travelBufferOverrides);
      if (bufAfterMs > 0) forbidden.push([lessonEnd, lessonEnd + bufAfterMs]);

      // Prevent a new slot at locationId from ending too close to next lesson at lesson pool.
      const bufBeforeMs = getTravelBufferMs(locationId, lesson.locationId, travelBufferOverrides);
      if (bufBeforeMs > 0) forbidden.push([lessonStart - bufBeforeMs, lessonStart]);
    }
  }

  for (const bt of blockedTimes) {
    forbidden.push([bt.startsAt.getTime(), bt.endsAt.getTime()]);
  }

  for (const gbt of gcalBusyTimes) {
    forbidden.push([gbt.startsAt.getTime(), gbt.endsAt.getTime()]);
  }

  const mergedForbidden = mergeIntervals(forbidden);

  // Daily lesson cap.
  const committedMinutes = existingLessons
    .filter((l) => getDateInLA(l.startsAt) === date)
    .reduce((sum, l) => sum + l.durationMinutes, 0);

  if (config.maxDailyLessonMinutes - committedMinutes < durationMinutes) return [];

  const durationMs = durationMinutes * MIN_MS;
  const slots: Slot[] = [];

  for (const window of windows) {
    for (const [gapStart, gapEnd] of subtractIntervals(window, mergedForbidden)) {
      const firstStart = Math.ceil(gapStart / FIFTEEN_MS) * FIFTEEN_MS;
      for (let t = firstStart; t + durationMs <= gapEnd; t += FIFTEEN_MS) {
        slots.push({ startsAt: new Date(t), endsAt: new Date(t + durationMs) });
      }
    }
  }

  // Booking advance window.
  const minStartMs = nowUtc.getTime() + config.bookingMinAdvanceHours * 60 * MIN_MS;
  const maxStartMs =
    nowUtc.getTime() + config.bookingMaxAdvanceWeeks * 7 * 24 * 60 * MIN_MS;

  return slots
    .filter((s) => s.startsAt.getTime() >= minStartMs && s.startsAt.getTime() <= maxStartMs)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

// Explains WHY a specific slot (startsAt + durationMinutes + locationId) is not
// available. Called from the recheck inside POST /lessons and PATCH /lessons/:id
// after computeAvailableSlots has already returned no match, so one of these
// reasons is guaranteed to fire. The order mirrors the filter order inside
// computeAvailableSlots; the first reason encountered wins.
export type SlotRejectionReason =
  | "not_a_lesson_day"
  | "outside_teaching_hours"
  | "occupied"
  | "travel_buffer_violated"
  | "blocked_time"
  | "google_calendar_busy"
  | "daily_cap_exceeded"
  | "too_soon"
  | "too_far";

export function diagnoseSlotRejection(
  params: SlotParams,
  slotStartMs: number,
): SlotRejectionReason {
  const {
    date,
    durationMinutes,
    locationId,
    existingLessons,
    blockedTimes,
    travelBufferOverrides,
    config,
    seasons,
    overrides,
    gcalBusyTimes,
    nowUtc,
  } = params;

  const slotEndMs = slotStartMs + durationMinutes * MIN_MS;
  const windows = resolveWindows(date, seasons, overrides, config);
  if (windows.length === 0) return "not_a_lesson_day";

  const insideWindow = windows.some(
    ([wStart, wEnd]) => slotStartMs >= wStart && slotEndMs <= wEnd,
  );
  if (!insideWindow) return "outside_teaching_hours";

  for (const lesson of existingLessons) {
    const lessonStart = lesson.startsAt.getTime();
    const lessonEnd = lessonStart + lesson.durationMinutes * MIN_MS;
    if (slotStartMs < lessonEnd && slotEndMs > lessonStart) {
      return "occupied";
    }
  }

  for (const lesson of existingLessons) {
    if (lesson.locationId === locationId) continue;
    const lessonStart = lesson.startsAt.getTime();
    const lessonEnd = lessonStart + lesson.durationMinutes * MIN_MS;
    const bufAfterMs = getTravelBufferMs(lesson.locationId, locationId, travelBufferOverrides);
    const bufBeforeMs = getTravelBufferMs(locationId, lesson.locationId, travelBufferOverrides);
    if (bufAfterMs > 0 && slotStartMs < lessonEnd + bufAfterMs && slotEndMs > lessonEnd) {
      return "travel_buffer_violated";
    }
    if (bufBeforeMs > 0 && slotStartMs < lessonStart && slotEndMs > lessonStart - bufBeforeMs) {
      return "travel_buffer_violated";
    }
  }

  for (const bt of blockedTimes) {
    if (slotStartMs < bt.endsAt.getTime() && slotEndMs > bt.startsAt.getTime()) {
      return "blocked_time";
    }
  }

  for (const gbt of gcalBusyTimes) {
    if (slotStartMs < gbt.endsAt.getTime() && slotEndMs > gbt.startsAt.getTime()) {
      return "google_calendar_busy";
    }
  }

  const committedMinutes = existingLessons
    .filter((lesson) => getDateInLA(lesson.startsAt) === date)
    .reduce((sum, lesson) => sum + lesson.durationMinutes, 0);
  if (committedMinutes + durationMinutes > config.maxDailyLessonMinutes) {
    return "daily_cap_exceeded";
  }

  const minStartMs = nowUtc.getTime() + config.bookingMinAdvanceHours * 60 * MIN_MS;
  const maxStartMs =
    nowUtc.getTime() + config.bookingMaxAdvanceWeeks * 7 * 24 * 60 * MIN_MS;
  if (slotStartMs < minStartMs) return "too_soon";
  if (slotStartMs > maxStartMs) return "too_far";

  // Fall-through: unlikely but keeps the type total. Treat as outside hours
  // (e.g. a slot not on a 15-min boundary inside the window).
  return "outside_teaching_hours";
}

export function classifyDaySlots(params: SlotParams): SlotWithState[] {
  const {
    date,
    durationMinutes,
    locationId,
    existingLessons,
    blockedTimes,
    travelBufferOverrides,
    config,
    seasons,
    overrides,
    gcalBusyTimes,
    nowUtc,
  } = params;

  const windows = resolveWindows(date, seasons, overrides, config);
  if (windows.length === 0) return [];

  const forbidden: Interval[] = [];

  for (const lesson of existingLessons) {
    const lessonStart = lesson.startsAt.getTime();
    const lessonEnd = lessonStart + lesson.durationMinutes * MIN_MS;
    forbidden.push([lessonStart, lessonEnd]);
    if (lesson.locationId !== locationId) {
      const bufAfterMs = getTravelBufferMs(lesson.locationId, locationId, travelBufferOverrides);
      if (bufAfterMs > 0) forbidden.push([lessonEnd, lessonEnd + bufAfterMs]);
      const bufBeforeMs = getTravelBufferMs(locationId, lesson.locationId, travelBufferOverrides);
      if (bufBeforeMs > 0) forbidden.push([lessonStart - bufBeforeMs, lessonStart]);
    }
  }

  for (const bt of blockedTimes) forbidden.push([bt.startsAt.getTime(), bt.endsAt.getTime()]);
  for (const gbt of gcalBusyTimes) forbidden.push([gbt.startsAt.getTime(), gbt.endsAt.getTime()]);

  const mergedForbidden = mergeIntervals(forbidden);

  const committedMinutes = existingLessons
    .filter((lesson) => getDateInLA(lesson.startsAt) === date)
    .reduce((sum, lesson) => sum + lesson.durationMinutes, 0);
  const capExceeded = committedMinutes + durationMinutes > config.maxDailyLessonMinutes;

  const durationMs = durationMinutes * MIN_MS;
  const nowMs = nowUtc.getTime();
  const minMs = nowMs + config.bookingMinAdvanceHours * 60 * MIN_MS;
  const maxMs = nowMs + config.bookingMaxAdvanceWeeks * 7 * 24 * 60 * MIN_MS;

  const result: SlotWithState[] = [];

  for (const [windowStart, windowEnd] of windows) {
    const firstStart = Math.ceil(windowStart / FIFTEEN_MS) * FIFTEEN_MS;
    for (let t = firstStart; t + durationMs <= windowEnd; t += FIFTEEN_MS) {
      const slotEnd = t + durationMs;
      let state: SlotState;

      if (t < nowMs) {
        state = "past";
      } else if (t < minMs) {
        state = "too_soon";
      } else if (
        capExceeded ||
        mergedForbidden.some(([fStart, fEnd]) => t < fEnd && slotEnd > fStart)
      ) {
        state = "unavailable";
      } else if (t > maxMs) {
        state = "not_open_yet";
      } else {
        state = "available";
      }

      result.push({ startsAt: new Date(t).toISOString(), state });
    }
  }

  return result;
}
