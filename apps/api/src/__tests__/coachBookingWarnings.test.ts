import { describe, it, expect } from "vitest";
import { computeCoachBookingWarnings, type ComputeCoachBookingWarningsInput } from "../lib/coachBookingWarnings";

const CONFIG = {
  id: "11111111-1111-1111-1111-111111111111",
  maxDailyLessonMinutes: 240,
  bookingMinAdvanceHours: 16,
  bookingMaxAdvanceWeeks: 10,
  defaultTeachesDays: [1, 2, 3, 4, 5, 6, 7],
  defaultStartTime: "16:00:00",
  defaultEndTime: "20:00:00",
  createdAt: new Date("2025-01-01T00:00:00Z"),
  updatedAt: new Date("2025-01-01T00:00:00Z"),
};

// Fixed "now" in July 2026, well inside PDT. Keeps DST noise out of the
// assertions — the warning function doesn't care about DST transitions
// directly, but the LA-wall-clock derivation does.
const NOW = new Date("2026-07-15T20:00:00.000Z"); // 1:00 PM LA, PDT

// 4:00 PM PDT the same day → 23:00 UTC. Inside the default 16:00–20:00
// teaching window.
const INSIDE_HOURS = new Date("2026-07-15T23:00:00.000Z");

// 2:00 PM PDT the same day → 21:00 UTC. Before the teaching window opens.
const BEFORE_HOURS = new Date("2026-07-15T21:00:00.000Z");

function baseInput(overrides: Partial<ComputeCoachBookingWarningsInput> = {}): ComputeCoachBookingWarningsInput {
  return {
    startsAt: INSIDE_HOURS,
    durationMinutes: 30,
    locationId: "aaaaaaaa-0000-0000-0000-000000000001",
    laDateStr: "2026-07-15",
    nowUtc: NOW,
    config: { ...CONFIG },
    seasons: [],
    overrides: [],
    blocked: [],
    buffers: [],
    existingLessons: [],
    ...overrides,
  };
}

describe("computeCoachBookingWarnings", () => {
  it("returns all-false for a well-formed in-window slot with no conflicts", () => {
    expect(computeCoachBookingWarnings(baseInput())).toEqual({
      outsideHours: false,
      maxAdvanceExceeded: false,
      travelBufferViolated: false,
      dailyCapExceeded: false,
      blockedTimeOverlap: false,
    });
  });

  it("flags outsideHours when the slot starts before the teaching window", () => {
    const result = computeCoachBookingWarnings(baseInput({ startsAt: BEFORE_HOURS }));
    expect(result.outsideHours).toBe(true);
  });

  it("flags outsideHours when the slot's END spills past the teaching window", () => {
    // 19:45 PDT + 30min = 20:15 PDT, past the 20:00 close.
    const spillStart = new Date("2026-07-16T02:45:00.000Z"); // 19:45 LA
    const result = computeCoachBookingWarnings(
      baseInput({ startsAt: spillStart, durationMinutes: 30 }),
    );
    expect(result.outsideHours).toBe(true);
  });

  it("flags maxAdvanceExceeded when startsAt is beyond bookingMaxAdvanceWeeks", () => {
    const farFuture = new Date(NOW.getTime() + 11 * 7 * 24 * 60 * 60 * 1000);
    const result = computeCoachBookingWarnings(baseInput({ startsAt: farFuture }));
    expect(result.maxAdvanceExceeded).toBe(true);
  });

  it("does NOT fire a 16-hour notice warning — notice window is parent-only", () => {
    // 2 hours from NOW. Would have been insideNoticeWindow under the old
    // schema; the current CoachBookingWarnings shape has no such key.
    const soonStart = new Date(NOW.getTime() + 2 * 60 * 60 * 1000);
    const result = computeCoachBookingWarnings(
      baseInput({ startsAt: soonStart, laDateStr: "2026-07-15" }),
    );
    expect(result).not.toHaveProperty("insideNoticeWindow");
  });

  it("flags travelBufferViolated for a back-to-back lesson at a different pool using the default 30-min buffer", () => {
    const otherPool = "bbbbbbbb-0000-0000-0000-000000000002";
    const result = computeCoachBookingWarnings(
      baseInput({
        existingLessons: [
          {
            startsAt: new Date(INSIDE_HOURS.getTime() - 30 * 60_000),
            durationMinutes: 30,
            locationId: otherPool,
          },
        ],
      }),
    );
    expect(result.travelBufferViolated).toBe(true);
  });

  it("does NOT flag travelBufferViolated for a back-to-back lesson at the SAME pool", () => {
    const samePool = "aaaaaaaa-0000-0000-0000-000000000001";
    const result = computeCoachBookingWarnings(
      baseInput({
        existingLessons: [
          {
            startsAt: new Date(INSIDE_HOURS.getTime() - 30 * 60_000),
            durationMinutes: 30,
            locationId: samePool,
          },
        ],
      }),
    );
    expect(result.travelBufferViolated).toBe(false);
  });

  it("honors a buffer override that sets the travel time to 0", () => {
    const otherPool = "bbbbbbbb-0000-0000-0000-000000000002";
    const result = computeCoachBookingWarnings(
      baseInput({
        existingLessons: [
          {
            startsAt: new Date(INSIDE_HOURS.getTime() - 30 * 60_000),
            durationMinutes: 30,
            locationId: otherPool,
          },
        ],
        buffers: [
          {
            fromLocationId: otherPool,
            toLocationId: "aaaaaaaa-0000-0000-0000-000000000001",
            bufferMinutes: 0,
            createdAt: new Date(),
          },
        ],
      }),
    );
    expect(result.travelBufferViolated).toBe(false);
  });

  it("flags dailyCapExceeded when existing LA-day minutes + new duration > cap", () => {
    const nineExistingLessons = Array.from({ length: 8 }, (_, index) => ({
      startsAt: new Date(INSIDE_HOURS.getTime() + index * 30 * 60_000),
      durationMinutes: 30,
      locationId: "aaaaaaaa-0000-0000-0000-000000000001",
    }));
    // 8 * 30 = 240, which equals the cap. Adding another 30 → 270 > 240.
    const result = computeCoachBookingWarnings(
      baseInput({ existingLessons: nineExistingLessons }),
    );
    expect(result.dailyCapExceeded).toBe(true);
  });

  it("ignores lessons on a different LA day when summing the daily cap", () => {
    const otherDay = new Date("2026-07-14T23:00:00.000Z"); // yesterday 4 PM LA
    const result = computeCoachBookingWarnings(
      baseInput({
        existingLessons: Array.from({ length: 10 }, (_, index) => ({
          startsAt: new Date(otherDay.getTime() + index * 30 * 60_000),
          durationMinutes: 30,
          locationId: "aaaaaaaa-0000-0000-0000-000000000001",
        })),
      }),
    );
    expect(result.dailyCapExceeded).toBe(false);
  });

  it("flags blockedTimeOverlap when the slot range intersects a blocked window", () => {
    const result = computeCoachBookingWarnings(
      baseInput({
        blocked: [
          {
            id: "cccccccc-0000-0000-0000-000000000001",
            startsAt: new Date(INSIDE_HOURS.getTime() + 10 * 60_000),
            endsAt: new Date(INSIDE_HOURS.getTime() + 20 * 60_000),
            note: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      }),
    );
    expect(result.blockedTimeOverlap).toBe(true);
  });

  it("does NOT flag blockedTimeOverlap when the blocked window merely touches the slot boundary", () => {
    // Blocked window ENDS exactly when the slot starts — boundary-touching
    // is not overlapping (startMs < bEnd requires strict less-than).
    const result = computeCoachBookingWarnings(
      baseInput({
        blocked: [
          {
            id: "cccccccc-0000-0000-0000-000000000002",
            startsAt: new Date(INSIDE_HOURS.getTime() - 30 * 60_000),
            endsAt: new Date(INSIDE_HOURS.getTime()),
            note: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      }),
    );
    expect(result.blockedTimeOverlap).toBe(false);
  });
});
