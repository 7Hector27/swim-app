import { describe, it, expect } from "vitest";
import { computeAvailableSlots, classifyDaySlots } from "../lib/slots";
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

const FIFTEEN_MS = 15 * 60 * 1000;

// UTC ms for a wall-clock PDT time on BASE_DATE (Sept 16, 2025 PDT = UTC-7).
// Uses Date.UTC so hour+7 overflow rolls into the next day correctly.
// e.g. pdt("16:30") === new Date("2025-09-16T23:30:00.000Z").getTime()
//      pdt("17:30") === new Date("2025-09-17T00:30:00.000Z").getTime()
const pdt = (time: string): number => {
  const [hour, minute] = time.split(":").map(Number);
  return Date.UTC(2025, 8, 16, hour! + 7, minute!); // September = month index 8
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
    const hourMs = 60 * 60 * 1000;
    const existingLessons = [0, 1, 2, 3].map((index) => ({
      startsAt: new Date(base + index * hourMs),
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
    expect(slots[0]?.startsAt.getTime()).toBe(firstSlotMs + FIFTEEN_MS);
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
  // March 9, 2025 is a Sunday (ISO 7); config must include 7 to generate slots.
  // Clocks spring 2 AM PST → 3 AM PDT (UTC transition: 10:00 UTC).
  // School-year window 16:30–19:30 PDT = 23:30 UTC Mar 9 → 02:30 UTC Mar 10.
  // The 3-hour window yields 11 × 30-min slots.

  it("spring-forward day (2025-03-09, Sunday with lessonDays=[…,7]): 11 correct slots, no phantoms", () => {
    const config = makeConfig({ lessonDays: [1, 2, 3, 5, 7] });
    const slots = computeAvailableSlots(
      makeBaseParams({ date: "2025-03-09", config, nowUtc: new Date("2025-03-08T00:00:00.000Z") }),
    );
    expect(slots).toHaveLength(11);
    expect(slots[0]?.startsAt.toISOString()).toBe("2025-03-09T23:30:00.000Z"); // 16:30 PDT
    expect(slots[10]?.startsAt.toISOString()).toBe("2025-03-10T02:00:00.000Z"); // 19:00 PDT
    const startMs = slots.map((s) => s.startsAt.getTime());
    expect(new Set(startMs).size).toBe(startMs.length); // no phantom duplicates
  });

  it("Friday before spring forward (2025-03-07, PST): 4:30 PM LA = 00:30 UTC next day", () => {
    // ISO 5 (Friday), PST = UTC-8. 16:30 + 8 = 00:30 UTC March 8.
    const slots = computeAvailableSlots(
      makeBaseParams({ date: "2025-03-07", nowUtc: new Date("2025-03-06T00:00:00.000Z") }),
    );
    expect(slots[0]?.startsAt.toISOString()).toBe("2025-03-08T00:30:00.000Z");
  });

  it("Monday after spring forward (2025-03-10, PDT): 4:30 PM LA = 23:30 UTC same day", () => {
    // ISO 1 (Monday), PDT = UTC-7. 16:30 + 7 = 23:30 UTC March 10.
    const slots = computeAvailableSlots(
      makeBaseParams({ date: "2025-03-10", nowUtc: new Date("2025-03-09T00:00:00.000Z") }),
    );
    expect(slots[0]?.startsAt.toISOString()).toBe("2025-03-10T23:30:00.000Z");
  });

  it("advance window spanning PST→PDT: slot at UTC-15 h is excluded even when naive LA diff = 16 h", () => {
    // nowUtc = 08:30 UTC March 9 → in PST (before 10:00 UTC transition), LA = 00:30 PST.
    // Slot 16:30 PDT = 23:30 UTC March 9.  UTC gap = 15 h → EXCLUDED.
    // Naive "slotLA − nowLA" = 16:30 − 00:30 = 16 h; buggy code would include it.
    const config = makeConfig({ lessonDays: [1, 2, 3, 5, 7] });
    const nowUtc = new Date("2025-03-09T08:30:00.000Z");
    const slots = computeAvailableSlots(makeBaseParams({ date: "2025-03-09", config, nowUtc }));
    expect(slots.some((s) => s.startsAt.toISOString() === "2025-03-09T23:30:00.000Z")).toBe(false);
    // Slot 17:30 PDT = 00:30 UTC March 10: UTC gap = 16 h → INCLUDED.
    expect(slots.some((s) => s.startsAt.toISOString() === "2025-03-10T00:30:00.000Z")).toBe(true);
  });

  // ── DST — fall back (2025-11-02) ───────────────────────────────────────────
  // November 2, 2025 is a Sunday (ISO 7); config must include 7 to generate slots.
  // Clocks fall 2 AM PDT → 1 AM PST (UTC transition: 09:00 UTC).
  // School-year window 16:30–19:30 PST = 00:30 UTC Nov 3 → 03:30 UTC Nov 3.
  // The 3-hour window yields 11 × 30-min slots.

  it("fall-back day (2025-11-02, Sunday with lessonDays=[…,7]): 11 correct slots, no duplicates", () => {
    const config = makeConfig({ lessonDays: [1, 2, 3, 5, 7] });
    const slots = computeAvailableSlots(
      makeBaseParams({ date: "2025-11-02", config, nowUtc: new Date("2025-11-01T00:00:00.000Z") }),
    );
    expect(slots).toHaveLength(11);
    expect(slots[0]?.startsAt.toISOString()).toBe("2025-11-03T00:30:00.000Z"); // 16:30 PST
    expect(slots[10]?.startsAt.toISOString()).toBe("2025-11-03T03:00:00.000Z"); // 19:00 PST
    const startMs = slots.map((s) => s.startsAt.getTime());
    expect(new Set(startMs).size).toBe(startMs.length); // no duplicates from repeated 1–2 AM hour
  });

  it("Friday before fall back (2025-10-31, PDT): 4:30 PM LA = 23:30 UTC same day", () => {
    // ISO 5 (Friday), PDT = UTC-7. 16:30 + 7 = 23:30 UTC Oct 31.
    const slots = computeAvailableSlots(
      makeBaseParams({ date: "2025-10-31", nowUtc: new Date("2025-10-30T00:00:00.000Z") }),
    );
    expect(slots[0]?.startsAt.toISOString()).toBe("2025-10-31T23:30:00.000Z");
  });

  it("Monday after fall back (2025-11-03, PST): 4:30 PM LA = 00:30 UTC next day", () => {
    // ISO 1 (Monday), PST = UTC-8. 16:30 + 8 = 00:30 UTC Nov 4.
    const slots = computeAvailableSlots(
      makeBaseParams({ date: "2025-11-03", nowUtc: new Date("2025-11-02T00:00:00.000Z") }),
    );
    expect(slots[0]?.startsAt.toISOString()).toBe("2025-11-04T00:30:00.000Z");
  });

  // ── Summer end boundary ─────────────────────────────────────────────────────
  // summerEndDate = "2025-08-25" (Monday, ISO 1 — in lessonDays).
  // Aug 25 itself must use summer hours; Aug 26 (Tuesday) must use school-year hours.

  it("summer end boundary: date === summerEndDate uses summer hours", () => {
    const slots = computeAvailableSlots(
      makeBaseParams({
        date: "2025-08-25",
        summerEndDate: "2025-08-25",
        nowUtc: new Date("2025-08-24T00:00:00.000Z"),
      }),
    );
    // First summer slot: 07:00 PDT = 14:00 UTC Aug 25
    expect(slots[0]?.startsAt.toISOString()).toBe("2025-08-25T14:00:00.000Z");
  });

  it("summer end boundary: day after summerEndDate uses school-year hours", () => {
    const slots = computeAvailableSlots(
      makeBaseParams({
        date: "2025-08-26",
        summerEndDate: "2025-08-25",
        nowUtc: new Date("2025-08-25T00:00:00.000Z"),
      }),
    );
    // First school-year slot: 16:30 PDT = 23:30 UTC Aug 26
    expect(slots[0]?.startsAt.toISOString()).toBe("2025-08-26T23:30:00.000Z");
  });

  it("advance window spanning PDT→PST: slot at UTC+16 h is included even when naive LA diff = 15 h", () => {
    // nowUtc = 08:30 UTC Nov 2 → still PDT (before 09:00 UTC transition), LA = 01:30 PDT.
    // Slot 16:30 PST Nov 2 = 00:30 UTC Nov 3.  UTC gap = 16 h → INCLUDED.
    // Naive "slotLA − nowLA" = 16:30 − 01:30 = 15 h; buggy code would exclude it.
    const config = makeConfig({ lessonDays: [1, 2, 3, 5, 7] });
    const nowUtc = new Date("2025-11-02T08:30:00.000Z");
    const slots = computeAvailableSlots(makeBaseParams({ date: "2025-11-02", config, nowUtc }));
    expect(slots[0]?.startsAt.toISOString()).toBe("2025-11-03T00:30:00.000Z"); // exactly 16 UTC h out
    // 1 second later: 16 h − 1 s → first slot excluded; 16:45 PST (00:45 UTC Nov 3) included.
    const nowUtc1s = new Date("2025-11-02T08:30:01.000Z");
    const slots1s = computeAvailableSlots(
      makeBaseParams({ date: "2025-11-02", config, nowUtc: nowUtc1s }),
    );
    expect(slots1s[0]?.startsAt.toISOString()).toBe("2025-11-03T00:45:00.000Z");
  });
});

describe("classifyDaySlots", () => {
  // ── Closed day ──────────────────────────────────────────────────────────────

  it("returns [] for a day not in lessonDays", () => {
    // Saturday = ISO 6, not in [1,2,3,5]
    const result = classifyDaySlots(
      makeBaseParams({ date: "2025-09-20", nowUtc: new Date("2025-09-19T00:00:00.000Z") }),
    );
    expect(result).toHaveLength(0);
  });

  // ── Returns all slots (not just available) ──────────────────────────────────

  it("returns all teaching-window slots, not only available ones", () => {
    // Block the first slot to produce at least one unavailable; everything else available.
    const blockedTimes = [
      { startsAt: new Date(pdt("16:30")), endsAt: new Date(pdt("17:00")) },
    ];
    const result = classifyDaySlots(makeBaseParams({ blockedTimes }));

    // Without any lesson at all, computeAvailableSlots gives all 7 slots (16:30–19:30, 30 min).
    // The total teaching window is 3 h = 6 × 30-min slots. With 30-min block at 16:30, there are
    // still 5 available + at minimum 1 unavailable = more than the 5 available-only count.
    const availableCount = result.filter((s) => s.state === "available").length;
    const unavailableCount = result.filter((s) => s.state === "unavailable").length;
    expect(unavailableCount).toBeGreaterThan(0);
    expect(availableCount).toBeGreaterThan(0);
    expect(result.length).toBeGreaterThan(availableCount);
  });

  // ── Slot states ─────────────────────────────────────────────────────────────

  it("a blocked slot is 'unavailable'", () => {
    // Block exactly 16:30–17:00 PDT. The 30-min slot starting at 16:30 is blocked.
    const blocked = [{ startsAt: new Date(pdt("16:30")), endsAt: new Date(pdt("17:00")) }];
    const result = classifyDaySlots(makeBaseParams({ blockedTimes: blocked }));
    const slot = result.find((s) => s.startsAt === new Date(pdt("16:30")).toISOString());
    expect(slot?.state).toBe("unavailable");
  });

  it("slot exactly at nowUtc + bookingMinAdvanceHours is 'available'", () => {
    // First slot starts at pdt("16:30"). nowUtc = exactly 16 h before that.
    const firstSlotMs = pdt("16:30");
    const nowUtc = new Date(firstSlotMs - 16 * 60 * 60 * 1000);
    const result = classifyDaySlots(makeBaseParams({ nowUtc }));
    const slot = result.find((s) => s.startsAt === new Date(firstSlotMs).toISOString());
    expect(slot?.state).toBe("available");
  });

  it("slot one second short of bookingMinAdvanceHours is 'too_soon'", () => {
    const firstSlotMs = pdt("16:30");
    const nowUtc = new Date(firstSlotMs - 16 * 60 * 60 * 1000 + 1_000);
    const result = classifyDaySlots(makeBaseParams({ nowUtc }));
    const slot = result.find((s) => s.startsAt === new Date(firstSlotMs).toISOString());
    expect(slot?.state).toBe("too_soon");
  });

  it("slot in the past is 'past'", () => {
    // nowUtc is AFTER the first slot: set nowUtc to an hour after the teaching window starts.
    const nowUtc = new Date(pdt("17:30")); // inside the teaching window
    const result = classifyDaySlots(makeBaseParams({ nowUtc }));
    const pastSlots = result.filter((s) => s.state === "past");
    expect(pastSlots.length).toBeGreaterThan(0);
    // 16:30 slot is before nowUtc (17:30) → past
    const firstSlot = result.find((s) => s.startsAt === new Date(pdt("16:30")).toISOString());
    expect(firstSlot?.state).toBe("past");
  });

  it("slot beyond bookingMaxAdvanceWeeks is 'not_open_yet'", () => {
    // Place nowUtc 11 weeks before the teaching window — first slot would be at 11 weeks away.
    const firstSlotMs = pdt("16:30");
    const nowUtc = new Date(firstSlotMs - 11 * 7 * 24 * 60 * 60 * 1000);
    const result = classifyDaySlots(makeBaseParams({ nowUtc }));
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((s) => s.state === "not_open_yet")).toBe(true);
  });

  // ── Daily cap ───────────────────────────────────────────────────────────────

  it("when daily cap is reached, non-past/non-too_soon slots become 'unavailable'", () => {
    // Fill up 240 min of daily cap with 4 × 60-min lessons on BASE_DATE.
    const base = pdt("16:30");
    const hourMs = 60 * 60 * 1000;
    const existingLessons = [0, 1, 2, 3].map((index) => ({
      startsAt: new Date(base + index * hourMs),
      durationMinutes: 60,
      locationId: "pool-A",
    }));
    const result = classifyDaySlots(makeBaseParams({ existingLessons, durationMinutes: 30 }));
    // All slots must be unavailable (cap exceeded overrides available/not_open_yet)
    expect(result.length).toBeGreaterThan(0);
    for (const slot of result) {
      expect(["unavailable", "past", "too_soon"]).toContain(slot.state);
    }
  });

  // ── excludeLessonId behavior ────────────────────────────────────────────────

  it("passing existingLessons without the excluded lesson frees its slot", () => {
    // A lesson at 16:30 blocks that slot. When the caller removes it from existingLessons,
    // the slot becomes available — verifying classifyDaySlots does not fetch its own lessons.
    const lessonStart = new Date(pdt("16:30"));
    const withLesson = classifyDaySlots(
      makeBaseParams({ existingLessons: [{ startsAt: lessonStart, durationMinutes: 30, locationId: "pool-A" }] }),
    );
    const withoutLesson = classifyDaySlots(makeBaseParams({ existingLessons: [] }));

    const slotWithLesson = withLesson.find((s) => s.startsAt === lessonStart.toISOString());
    const slotWithoutLesson = withoutLesson.find((s) => s.startsAt === lessonStart.toISOString());

    expect(slotWithLesson?.state).toBe("unavailable");
    expect(slotWithoutLesson?.state).toBe("available");
  });

  // ── Summer / Seahawks gap ───────────────────────────────────────────────────

  it("summer day: no slots appear in the Seahawks gap (11:00–19:00 PDT)", () => {
    // July 15 2025 = Tuesday (ISO 2). Morning 07:00–11:00, evening 19:00–21:00 PDT.
    const morningEndMs = new Date("2025-07-15T18:00:00.000Z").getTime(); // 11:00 PDT = 18:00 UTC
    const eveningStartMs = new Date("2025-07-16T02:00:00.000Z").getTime(); // 19:00 PDT = 02:00 UTC next day

    const result = classifyDaySlots(
      makeBaseParams({ date: "2025-07-15", nowUtc: new Date("2025-07-14T00:00:00.000Z") }),
    );

    for (const slot of result) {
      const t = new Date(slot.startsAt).getTime();
      // No slot starts inside the gap [morningEnd, eveningStart)
      expect(t < morningEndMs || t >= eveningStartMs).toBe(true);
    }
    expect(result.some((s) => new Date(s.startsAt).getTime() < morningEndMs)).toBe(true);
    expect(result.some((s) => new Date(s.startsAt).getTime() >= eveningStartMs)).toBe(true);
  });

  // ── DST — spring forward (2025-03-09) ──────────────────────────────────────

  it("spring-forward week: classifyDaySlots on 2025-03-09 returns 11 slots with correct UTC starts", () => {
    const config = makeConfig({ lessonDays: [1, 2, 3, 5, 7] });
    const nowUtc = new Date("2025-03-08T00:00:00.000Z");
    const result = classifyDaySlots(makeBaseParams({ date: "2025-03-09", config, nowUtc }));
    // 16:30–19:30 PDT = 11 × 30-min slots
    expect(result).toHaveLength(11);
    expect(result[0]?.startsAt).toBe("2025-03-09T23:30:00.000Z"); // 16:30 PDT
    expect(result[10]?.startsAt).toBe("2025-03-10T02:00:00.000Z"); // 19:00 PDT
    const starts = result.map((s) => s.startsAt);
    expect(new Set(starts).size).toBe(starts.length); // no duplicate slots
  });

  // ── DST — fall back (2025-11-02) ───────────────────────────────────────────

  it("fall-back week: classifyDaySlots on 2025-11-02 returns 11 slots with no duplicates", () => {
    const config = makeConfig({ lessonDays: [1, 2, 3, 5, 7] });
    const nowUtc = new Date("2025-11-01T00:00:00.000Z");
    const result = classifyDaySlots(makeBaseParams({ date: "2025-11-02", config, nowUtc }));
    // 16:30–19:30 PST = 11 × 30-min slots
    expect(result).toHaveLength(11);
    expect(result[0]?.startsAt).toBe("2025-11-03T00:30:00.000Z"); // 16:30 PST
    expect(result[10]?.startsAt).toBe("2025-11-03T03:00:00.000Z"); // 19:00 PST
    const starts = result.map((s) => s.startsAt);
    expect(new Set(starts).size).toBe(starts.length);
  });

  // ── State ordering ──────────────────────────────────────────────────────────

  it("result is sorted in ascending startsAt order", () => {
    const result = classifyDaySlots(makeBaseParams());
    for (let index = 1; index < result.length; index++) {
      expect(result[index]!.startsAt >= result[index - 1]!.startsAt).toBe(true);
    }
  });
});
