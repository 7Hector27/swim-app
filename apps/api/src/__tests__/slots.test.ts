import { describe, it, expect } from "vitest";
import { computeAvailableSlots } from "../lib/slots";
import type { SlotParams } from "../lib/slots";
import type { AvailabilityConfig } from "@swim-app/shared";

// ── Helpers ───────────────────────────────────────────────────────────────────

// All tests use 2025-09-16 (Tuesday, PDT=UTC-7) as the base school-year date.
// Teaching window: 16:30–19:30 PDT = 23:30 UTC Sept 16 – 02:30 UTC Sept 17.
const BASE_DATE = "2025-09-16";

// nowUtc placed ~47 h before the window so the 16 h advance filter never
// interferes unless a test is specifically exercising it.
const BASE_NOW_UTC = new Date("2025-09-15T00:00:00.000Z");

const makeConfig = (overrides: Partial<AvailabilityConfig> = {}): AvailabilityConfig => ({
  id: "cfg-1",
  lessonDays: [1, 2, 3, 5], // Mon Tue Wed Fri
  schoolYearStartTime: "16:30",
  schoolYearEndTime: "19:30",
  summerMorningStartTime: "07:00",
  summerMorningEndTime: "11:00",
  summerEveningStartTime: "19:00",
  summerEveningEndTime: "21:00",
  maxDailyLessonMinutes: 240,
  bookingMinAdvanceHours: 16,
  bookingMaxAdvanceWeeks: 10,
  ...overrides,
});

const makeBaseParams = (overrides: Partial<SlotParams> = {}): SlotParams => ({
  date: BASE_DATE,
  durationMinutes: 30,
  locationId: "pool-A",
  existingLessons: [],
  blockedTimes: [],
  travelBufferOverrides: [],
  config: makeConfig(),
  summerEndDate: null,
  gcalBusyTimes: [],
  nowUtc: BASE_NOW_UTC,
  ...overrides,
});

// UTC ms for a wall-clock PDT time on BASE_DATE (Sept 16, 2025 PDT = UTC-7).
// Uses Date.UTC so hour+7 overflow rolls into the next day correctly.
// e.g. pdt("16:30") === new Date("2025-09-16T23:30:00.000Z").getTime()
//      pdt("17:30") === new Date("2025-09-17T00:30:00.000Z").getTime()
const pdt = (time: string): number => {
  const [h, m] = time.split(":").map(Number);
  return Date.UTC(2025, 8, 16, h! + 7, m!); // September = month index 8
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("computeAvailableSlots", () => {
  // ── lesson_days gate ────────────────────────────────────────────────────────

  it("returns empty when date is not in lesson_days", () => {
    // Saturday = ISO 6, not in [1,2,3,5]
    const slots = computeAvailableSlots(
      makeBaseParams({ date: "2025-09-20", nowUtc: new Date("2025-09-19T00:00:00.000Z") }),
    );
    expect(slots).toHaveLength(0);
  });

  it("lesson_days config: removing Wednesday makes Wednesday return empty", () => {
    // Sept 17 is Wednesday (ISO 3)
    const slotsWithout = computeAvailableSlots(
      makeBaseParams({
        date: "2025-09-17",
        config: makeConfig({ lessonDays: [1, 2, 5] }),
        nowUtc: new Date("2025-09-16T00:00:00.000Z"),
      }),
    );
    expect(slotsWithout).toHaveLength(0);

    const slotsWith = computeAvailableSlots(
      makeBaseParams({
        date: "2025-09-17",
        config: makeConfig({ lessonDays: [1, 2, 3, 5] }),
        nowUtc: new Date("2025-09-16T00:00:00.000Z"),
      }),
    );
    expect(slotsWith.length).toBeGreaterThan(0);
  });

  // ── Teaching-window boundaries ──────────────────────────────────────────────

  it("school year day: no slots before schoolYearStartTime", () => {
    const slots = computeAvailableSlots(makeBaseParams());
    const windowStartMs = pdt("16:30");
    for (const slot of slots) {
      expect(slot.startsAt.getTime()).toBeGreaterThanOrEqual(windowStartMs);
    }
  });

  it("summer day: no slots in the 11:00–19:00 Seahawks gap", () => {
    // July 15 = Tuesday (ISO 2). PDT=UTC-7.
    // Morning end: 11:00 PDT = 18:00 UTC July 15
    // Evening start: 19:00 PDT = 02:00 UTC July 16
    const morningEndMs = new Date("2025-07-15T18:00:00.000Z").getTime();
    const eveningStartMs = new Date("2025-07-16T02:00:00.000Z").getTime();

    const slots = computeAvailableSlots(
      makeBaseParams({
        date: "2025-07-15",
        nowUtc: new Date("2025-07-14T00:00:00.000Z"),
      }),
    );

    for (const slot of slots) {
      const t = slot.startsAt.getTime();
      expect(t < morningEndMs || t >= eveningStartMs).toBe(true);
    }
    expect(slots.some((s) => s.startsAt.getTime() < morningEndMs)).toBe(true);
    expect(slots.some((s) => s.startsAt.getTime() >= eveningStartMs)).toBe(true);
  });

  // ── Season boundary ─────────────────────────────────────────────────────────

  it("June 1 uses summer hours; May 31 uses school-year hours", () => {
    // Both May 31 (Sat, ISO 6) and June 1 (Sun, ISO 7) require lessonDays=[1–7].
    const config = makeConfig({ lessonDays: [1, 2, 3, 4, 5, 6, 7] });
    const nowUtc = new Date("2025-05-30T00:00:00.000Z");

    const summerSlots = computeAvailableSlots(
      makeBaseParams({ date: "2025-06-01", config, nowUtc }),
    );
    // First summer slot: 07:00 PDT = 14:00 UTC June 1
    expect(summerSlots[0]?.startsAt.toISOString()).toBe("2025-06-01T14:00:00.000Z");

    const schoolSlots = computeAvailableSlots(
      makeBaseParams({ date: "2025-05-31", config, nowUtc }),
    );
    // First school-year slot: 16:30 PDT = 23:30 UTC May 31
    expect(schoolSlots[0]?.startsAt.toISOString()).toBe("2025-05-31T23:30:00.000Z");
  });

  // ── Existing-lesson blocking ────────────────────────────────────────────────

  it("pending lesson (passed as existingLesson) blocks its slot", () => {
    const lessonStart = new Date(pdt("16:30"));
    const slots = computeAvailableSlots(
      makeBaseParams({
        existingLessons: [
          { startsAt: lessonStart, durationMinutes: 30, locationId: "pool-A" },
        ],
      }),
    );
    expect(slots.some((s) => s.startsAt.getTime() === lessonStart.getTime())).toBe(false);
  });

  it("approved lesson (passed as existingLesson) blocks its slot", () => {
    const lessonStart = new Date(pdt("17:00"));
    const slots = computeAvailableSlots(
      makeBaseParams({
        existingLessons: [
          { startsAt: lessonStart, durationMinutes: 30, locationId: "pool-A" },
        ],
      }),
    );
    expect(slots.some((s) => s.startsAt.getTime() === lessonStart.getTime())).toBe(false);
  });

  it("declined/expired/canceled/no_show/completed lessons do not block (caller must exclude them)", () => {
    // Caller is responsible for filtering by status before passing existingLessons.
    // An empty list (representing all declined/etc.) leaves the slot open.
    const slotsWithLesson = computeAvailableSlots(
      makeBaseParams({
        existingLessons: [
          { startsAt: new Date(pdt("16:30")), durationMinutes: 30, locationId: "pool-A" },
        ],
      }),
    );
    const slotsWithout = computeAvailableSlots(makeBaseParams());

    // With lesson: 16:30 blocked
    expect(slotsWithLesson.some((s) => s.startsAt.getTime() === pdt("16:30"))).toBe(false);
    // Without lesson: 16:30 available
    expect(slotsWithout.some((s) => s.startsAt.getTime() === pdt("16:30"))).toBe(true);
  });

  // ── Travel buffers ──────────────────────────────────────────────────────────

  it("back-to-back same-pool: no buffer gap, next slot starts immediately after lesson", () => {
    // Lesson at pool-A 16:30–17:00; next slot should be 17:00.
    const lessonStart = new Date(pdt("16:30"));
    const slots = computeAvailableSlots(
      makeBaseParams({
        existingLessons: [{ startsAt: lessonStart, durationMinutes: 30, locationId: "pool-A" }],
      }),
    );
    expect(slots.some((s) => s.startsAt.getTime() === lessonStart.getTime())).toBe(false);
    // 17:00 PDT = 2025-09-17T00:00:00.000Z
    expect(slots.some((s) => s.startsAt.toISOString() === "2025-09-17T00:00:00.000Z")).toBe(true);
  });

  it("different-pool lesson before: 30-min arrival buffer prevents slot starting too soon", () => {
    // Lesson at pool-B ends 17:00 PDT. Buffer B→A = 30 min. First pool-A slot = 17:30.
    const lessonStart = new Date(pdt("16:30"));
    const slots = computeAvailableSlots(
      makeBaseParams({
        existingLessons: [{ startsAt: lessonStart, durationMinutes: 30, locationId: "pool-B" }],
        locationId: "pool-A",
      }),
    );
    // No slot between 16:30 and 17:30 PDT
    const windowOpenMs = pdt("17:30");
    for (const slot of slots) {
      if (slot.startsAt.getTime() >= pdt("16:30")) {
        expect(slot.startsAt.getTime()).toBeGreaterThanOrEqual(windowOpenMs);
      }
    }
    // 17:30 slot exists (2025-09-17T00:30:00.000Z)
    expect(slots.some((s) => s.startsAt.toISOString() === "2025-09-17T00:30:00.000Z")).toBe(true);
  });

  it("different-pool lesson after: 30-min departure buffer prevents slot ending too late", () => {
    // Lesson at pool-B starts 18:00 PDT. Buffer A→B = 30 min.
    // Slot at pool-A must end by 17:30 PDT. 17:00 start (ends 17:30) fits; 17:15 (ends 17:45) doesn't.
    const lessonStart = new Date(pdt("18:00"));
    const slots = computeAvailableSlots(
      makeBaseParams({
        existingLessons: [{ startsAt: lessonStart, durationMinutes: 30, locationId: "pool-B" }],
        locationId: "pool-A",
      }),
    );
    // 17:00 slot (ends 17:30) — exists
    expect(slots.some((s) => s.startsAt.toISOString() === "2025-09-17T00:00:00.000Z")).toBe(true);
    // 17:15 slot (ends 17:45) — blocked by departure buffer
    expect(slots.some((s) => s.startsAt.toISOString() === "2025-09-17T00:15:00.000Z")).toBe(false);
  });

  it("custom travel buffer override is respected over the 30-min default", () => {
    // Override B→A buffer to 10 min. Lesson at pool-B ends 17:00 PDT.
    // Buffer = 10 min → pool-A slot available from 17:10 PDT → first 15-min slot at 17:15.
    const lessonStart = new Date(pdt("16:30"));
    const slots = computeAvailableSlots(
      makeBaseParams({
        existingLessons: [{ startsAt: lessonStart, durationMinutes: 30, locationId: "pool-B" }],
        locationId: "pool-A",
        travelBufferOverrides: [
          { fromLocationId: "pool-B", toLocationId: "pool-A", bufferMinutes: 10 },
          { fromLocationId: "pool-A", toLocationId: "pool-B", bufferMinutes: 10 },
        ],
      }),
    );
    // With 10-min buffer, 17:15 slot (2025-09-17T00:15:00.000Z) is available
    expect(slots.some((s) => s.startsAt.toISOString() === "2025-09-17T00:15:00.000Z")).toBe(true);
    // But 17:00 slot would be inside the 10-min buffer (lesson ends 17:00, buffer until 17:10)
    expect(slots.some((s) => s.startsAt.toISOString() === "2025-09-17T00:00:00.000Z")).toBe(false);
  });

  // ── Daily lesson cap ────────────────────────────────────────────────────────

  it("returns empty when maxDailyLessonMinutes is fully committed", () => {
    // 4 × 60 min = 240 min = maxDailyLessonMinutes; no room for a 30-min slot.
    const base = pdt("16:30");
    const h = 60 * 60 * 1000;
    const existingLessons = [0, 1, 2, 3].map((index) => ({
      startsAt: new Date(base + index * h),
      durationMinutes: 60,
      locationId: "pool-A",
    }));
    const slots = computeAvailableSlots(makeBaseParams({ existingLessons, durationMinutes: 30 }));
    expect(slots).toHaveLength(0);
  });

  // ── Advance window ──────────────────────────────────────────────────────────

  it("slot exactly 16 h from nowUtc is included", () => {
    // First slot: 16:30 PDT = pdt("16:30"). nowUtc exactly 16 h before it.
    const firstSlotMs = pdt("16:30");
    const nowUtc = new Date(firstSlotMs - 16 * 60 * 60 * 1000);
    const slots = computeAvailableSlots(makeBaseParams({ nowUtc }));
    expect(slots[0]?.startsAt.getTime()).toBe(firstSlotMs);
  });

  it("slot one second short of 16 h is excluded; next 15-min slot is included", () => {
    const firstSlotMs = pdt("16:30");
    const nowUtc = new Date(firstSlotMs - 16 * 60 * 60 * 1000 + 1_000);
    const slots = computeAvailableSlots(makeBaseParams({ nowUtc }));
    expect(slots[0]?.startsAt.getTime()).not.toBe(firstSlotMs);
    expect(slots[0]?.startsAt.getTime()).toBeGreaterThan(firstSlotMs);
  });

  it("slots more than 10 weeks out are excluded", () => {
    // Place nowUtc 11 weeks before the teaching window — all slots exceed 10-week cap.
    const firstSlotMs = pdt("16:30");
    const nowUtc = new Date(firstSlotMs - 11 * 7 * 24 * 60 * 60 * 1000);
    const slots = computeAvailableSlots(makeBaseParams({ nowUtc }));
    expect(slots).toHaveLength(0);
  });

  // ── Blocked times ───────────────────────────────────────────────────────────

  it("blocked time removes that portion of the teaching window", () => {
    // Block 17:00–18:00 PDT.
    const blockedTimes = [
      {
        startsAt: new Date(pdt("17:00")),
        endsAt: new Date(pdt("18:00")),
      },
    ];
    const slots = computeAvailableSlots(makeBaseParams({ blockedTimes }));
    const blockStart = pdt("17:00");
    const blockEnd = pdt("18:00");
    for (const slot of slots) {
      const t = slot.startsAt.getTime();
      expect(t < blockStart || t >= blockEnd).toBe(true);
    }
    expect(slots.some((s) => s.startsAt.getTime() < blockStart)).toBe(true);
    expect(slots.some((s) => s.startsAt.getTime() >= blockEnd)).toBe(true);
  });

  it("blocked time spanning the full teaching window returns empty", () => {
    const blockedTimes = [
      {
        startsAt: new Date(pdt("16:30")),
        endsAt: new Date(pdt("19:30")),
      },
    ];
    expect(computeAvailableSlots(makeBaseParams({ blockedTimes }))).toHaveLength(0);
  });

  // ── Slot fit and granularity ────────────────────────────────────────────────

  it("30-min lesson fits a 30-min gap; 45-min does not", () => {
    // Leave only [17:00, 17:30] open.
    const blockedTimes = [
      { startsAt: new Date(pdt("16:30")), endsAt: new Date(pdt("17:00")) },
      { startsAt: new Date(pdt("17:30")), endsAt: new Date(pdt("19:30")) },
    ];
    const slots30 = computeAvailableSlots(
      makeBaseParams({ durationMinutes: 30, blockedTimes }),
    );
    const slots45 = computeAvailableSlots(
      makeBaseParams({ durationMinutes: 45, blockedTimes }),
    );
    expect(slots30).toHaveLength(1);
    expect(slots45).toHaveLength(0);
  });

  it("slot start times are at 15-minute granularity", () => {
    const slots = computeAvailableSlots(makeBaseParams());
    for (const slot of slots) {
      expect(slot.startsAt.getTime() % FIFTEEN_MS).toBe(0);
    }
  });

  // ── GCal busy times ─────────────────────────────────────────────────────────

  it("GCal busy time overlapping teaching window reduces available slots", () => {
    // Block 17:00–18:00 PDT via GCal.
    const gcalBusyTimes = [
      { startsAt: new Date(pdt("17:00")), endsAt: new Date(pdt("18:00")) },
    ];
    const slots = computeAvailableSlots(makeBaseParams({ gcalBusyTimes }));
    const blockStart = pdt("17:00");
    const blockEnd = pdt("18:00");
    for (const slot of slots) {
      const t = slot.startsAt.getTime();
      expect(t < blockStart || t >= blockEnd).toBe(true);
    }
    expect(slots.some((s) => s.startsAt.getTime() < blockStart)).toBe(true);
    expect(slots.some((s) => s.startsAt.getTime() >= blockEnd)).toBe(true);
  });

  // ── DST — spring forward (2025-03-09) ──────────────────────────────────────

  it("DST spring forward: correct wall-clock slots, no phantom times", () => {
    // March 9, 2025 is a Sunday (ISO 7). Clocks spring 2 AM → 3 AM.
    // After the transition, LA is PDT (UTC-7).
    // School-year window 16:30–19:30 PDT = 23:30 UTC Mar 9 → 02:30 UTC Mar 10.
    const config = makeConfig({ lessonDays: [1, 2, 3, 5, 7] });
    const nowUtc = new Date("2025-03-08T00:00:00.000Z"); // 47 h before window

    const slots = computeAvailableSlots(
      makeBaseParams({ date: "2025-03-09", config, nowUtc }),
    );

    expect(slots.length).toBeGreaterThan(0);
    // First 30-min slot: 16:30 PDT = 23:30 UTC March 9
    expect(slots[0]?.startsAt.toISOString()).toBe("2025-03-09T23:30:00.000Z");
    // No duplicate start times (no phantom slots from the missing 2–3 AM hour)
    const startMs = slots.map((s) => s.startsAt.getTime());
    expect(new Set(startMs).size).toBe(startMs.length);
  });

  // ── DST — fall back (2025-11-02) ───────────────────────────────────────────

  it("DST fall back: correct wall-clock slots, no duplicate times", () => {
    // November 2, 2025 is a Sunday (ISO 7). Clocks fall 2 AM → 1 AM.
    // After the transition, LA is PST (UTC-8).
    // School-year window 16:30–19:30 PST = 00:30 UTC Nov 3 → 03:30 UTC Nov 3.
    const config = makeConfig({ lessonDays: [1, 2, 3, 5, 7] });
    const nowUtc = new Date("2025-11-01T00:00:00.000Z");

    const slots = computeAvailableSlots(
      makeBaseParams({ date: "2025-11-02", config, nowUtc }),
    );

    expect(slots.length).toBeGreaterThan(0);
    // First 30-min slot: 16:30 PST = 00:30 UTC November 3
    expect(slots[0]?.startsAt.toISOString()).toBe("2025-11-03T00:30:00.000Z");
    // No duplicate start times (the repeated 1–2 AM hour doesn't affect the window)
    const startMs = slots.map((s) => s.startsAt.getTime());
    expect(new Set(startMs).size).toBe(startMs.length);
  });
});

// ── Module-level constant used in granularity test ─────────────────────────
const FIFTEEN_MS = 15 * 60 * 1000;
