// Helpers for Phase 1 batch booking (ADR 030). Expand weekly-mode candidates
// into a stable, index-addressable list, apply skips and overrides, and map
// slot-engine rejection reasons into the batch pick-state enum used by the
// preview + submit response schemas.

import { laToUtc, type SlotRejectionReason } from "./slots";
import type { BatchPickState, BatchWeeklyOverride } from "@swim-app/shared";

// ── Weekly expansion ────────────────────────────────────────────────────────

export interface WeeklyExpandParams {
  // ISO weekday numbers (1=Mon … 7=Sun). The caller is responsible for
  // deduping and sorting if the stable order matters externally; this
  // function respects the given order so the client's `weekdays` input
  // determines the index assignment.
  weekdays: number[];
  // Local America/Los_Angeles time of day, e.g. "16:30".
  timeOfDay: string;
  // LA calendar date of the first candidate week, e.g. "2026-11-02".
  startDate: string;
  // Number of weeks the parent requested.
  weeks: number;
}

export interface Candidate {
  // Stable position inside the full expanded list. Clients reference this
  // from `overrides[].index` and `skips[]`.
  index: number;
  startsAt: Date;
}

/**
 * Expand a weekly rule into a flat list of candidate lessons. The order is
 * week-then-weekday: all weekdays for week 0, then all weekdays for week 1,
 * and so on. The resulting index is stable across preview and submit so the
 * client can address a specific candidate by index.
 */
export function expandWeeklyCandidates(params: WeeklyExpandParams): Candidate[] {
  const { weekdays, timeOfDay, startDate, weeks } = params;
  const sortedUniqueWeekdays = Array.from(new Set(weekdays)).sort((a, b) => a - b);

  // The first candidate for weekday W is on or after startDate (the parent
  // picked startDate as the start of the series's first week).
  const startIsoWeekday = isoWeekdayFor(startDate); // 1..7

  const candidates: Candidate[] = [];
  let index = 0;
  for (let weekIndex = 0; weekIndex < weeks; weekIndex++) {
    for (const weekday of sortedUniqueWeekdays) {
      // Offset within the first week: how many days from startDate until the
      // next occurrence of `weekday`. If startDate itself IS `weekday`, offset
      // is 0 and the first candidate is startDate.
      const firstWeekOffset = (weekday - startIsoWeekday + 7) % 7;
      const totalDayOffset = weekIndex * 7 + firstWeekOffset;
      const dateStr = addDaysToLaDate(startDate, totalDayOffset);
      const startsAt = laToUtc(dateStr, timeOfDay);
      candidates.push({ index, startsAt });
      index++;
    }
  }
  return candidates;
}

/**
 * Apply weekly `overrides` and `skips` to an expanded candidate list. Skips
 * drop candidates by index; overrides replace a candidate's `startsAt` while
 * keeping its index position in the output.
 */
export function applyWeeklyOverridesAndSkips(
  candidates: Candidate[],
  overrides: BatchWeeklyOverride[],
  skips: number[],
): Candidate[] {
  const skipSet = new Set(skips);
  const overrideByIndex = new Map<number, BatchWeeklyOverride>(
    overrides.map((o) => [o.index, o]),
  );
  const result: Candidate[] = [];
  for (const candidate of candidates) {
    if (skipSet.has(candidate.index)) continue;
    const override = overrideByIndex.get(candidate.index);
    if (override) {
      result.push({ index: candidate.index, startsAt: new Date(override.startsAt) });
    } else {
      result.push(candidate);
    }
  }
  return result;
}

// ── Slot-engine reason mapping ─────────────────────────────────────────────

/**
 * Translate the slot engine's `SlotRejectionReason` into the batch pick-state
 * enum used across preview and submit responses. The slot engine's enum
 * covers all per-slot rejections; the batch enum merges travel buffer and
 * daily cap into the generic `unavailable` state because the UI treats both
 * as "that time is taken."
 */
export function slotRejectionToPickState(reason: SlotRejectionReason): BatchPickState {
  switch (reason) {
    case "not_a_lesson_day":
      return "day_closed";
    case "outside_teaching_hours":
      return "outside_hours";
    case "occupied":
      return "unavailable";
    case "travel_buffer_violated":
      return "unavailable";
    case "blocked_time":
      return "blocked_time";
    case "google_calendar_busy":
      return "unavailable";
    case "daily_cap_exceeded":
      return "unavailable";
    case "too_soon":
      return "too_soon";
    case "too_far":
      return "not_open_yet";
  }
}

// ── Private helpers ────────────────────────────────────────────────────────

function isoWeekdayFor(dateStr: string): number {
  // dateStr is a YYYY-MM-DD in LA — the ISO weekday depends on the date, not
  // the time of day, so we can treat it as a UTC midnight for weekday math.
  const [year, month, day] = dateStr.split("-").map((part) => Number(part));
  const utc = new Date(Date.UTC(year!, month! - 1, day!));
  // getUTCDay returns 0..6 with Sunday=0. ISO is 1..7 with Monday=1, Sunday=7.
  const jsDow = utc.getUTCDay();
  return jsDow === 0 ? 7 : jsDow;
}

function addDaysToLaDate(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split("-").map((part) => Number(part));
  const base = new Date(Date.UTC(year!, month! - 1, day!));
  base.setUTCDate(base.getUTCDate() + days);
  const yr = base.getUTCFullYear();
  const mo = String(base.getUTCMonth() + 1).padStart(2, "0");
  const dy = String(base.getUTCDate()).padStart(2, "0");
  return `${yr}-${mo}-${dy}`;
}
