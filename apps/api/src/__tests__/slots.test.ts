import { describe, it, expect } from "vitest";
import { computeAvailableSlots, classifyDaySlots } from "../lib/slots";
import type { SlotParams } from "../lib/slots";
import type { AvailabilityConfig, AvailabilitySeason, AvailabilityOverride } from "@swim-app/shared";

// ── Helpers ───────────────────────────────────────────────────────────────────

// All tests use 2025-09-16 (Tuesday, PDT=UTC-7) as the base school-year date.
// Teaching window: 16:30–19:30 PDT = 23:30 UTC Sept 16 – 02:30 UTC Sept 17.
const BASE_DATE = "2025-09-16";

// nowUtc placed ~47 h before the window so the 16 h advance filter never
// interferes unless a test is specifically exercising it.
const BASE_NOW_UTC = new Date("2025-09-15T00:00:00.000Z");

const makeConfig = (overrides: Partial<AvailabilityConfig> = {}): AvailabilityConfig => ({
  id: "cfg-1",
  maxDailyLessonMinutes: 240,
  bookingMinAdvanceHours: 16,
  bookingMaxAdvanceWeeks: 10,
  defaultTeachesDays: [2, 3, 4, 5],
  defaultStartTime: "16:00",
  defaultEndTime: "20:00",
  ...overrides,
});

const makeSeason = (overrides: Partial<AvailabilitySeason> = {}): AvailabilitySeason => ({
  id: "season-base",
  name: "School year",
  startDate: "2025-01-01",
  endDate: "2099-12-31",
  teachesDays: [1, 2, 3, 5], // Mon Tue Wed Fri
  weekdayStartTime: "16:30",
  weekdayEndTime: "19:30",
  weekendStartTime: "16:30",
  weekendEndTime: "19:30",
  startsAtDst: false,
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z",
  ...overrides,
});

const makeOverride = (overrides: Partial<AvailabilityOverride> = {}): AvailabilityOverride => ({
  id: "override-x",
  kind: "day_off",
  startDate: "2025-09-16",
  endDate: "2025-09-16",
  startTime: null,
  endTime: null,
  note: null,
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z",
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
  seasons: [makeSeason()],
  overrides: [],
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
  // ── teaches_days gate (via season) ──────────────────────────────────────────

  it("returns empty when the date's weekday is not in the season's teaches_days", () => {
    // Saturday = ISO 6, not in [1,2,3,5]
    const slots = computeAvailableSlots(
      makeBaseParams({ date: "2025-09-20", nowUtc: new Date("2025-09-19T00:00:00.000Z") }),
    );
    expect(slots).toHaveLength(0);
  });

  it("teaches_days: removing Wednesday makes Wednesday return empty", () => {
    // Sept 17 is Wednesday (ISO 3)
    const slotsWithout = computeAvailableSlots(
      makeBaseParams({
        date: "2025-09-17",
        seasons: [makeSeason({ teachesDays: [1, 2, 5] })],
        nowUtc: new Date("2025-09-16T00:00:00.000Z"),
      }),
    );
    expect(slotsWithout).toHaveLength(0);

    const slotsWith = computeAvailableSlots(
      makeBaseParams({
        date: "2025-09-17",
        seasons: [makeSeason({ teachesDays: [1, 2, 3, 5] })],
        nowUtc: new Date("2025-09-16T00:00:00.000Z"),
      }),
    );
    expect(slotsWith.length).toBeGreaterThan(0);
  });

  // ── Teaching-window boundaries ──────────────────────────────────────────────

  it("no slots before the season's weekday_start_time", () => {
    const slots = computeAvailableSlots(makeBaseParams());
    const windowStartMs = pdt("16:30");
    for (const slot of slots) {
      expect(slot.startsAt.getTime()).toBeGreaterThanOrEqual(windowStartMs);
    }
  });

  // ── Season boundary ─────────────────────────────────────────────────────────

  it("season change at boundary: date D uses the new season's hours; D-1 uses the old season's hours", () => {
    // Both May 31 (Sat, ISO 6) and June 1 (Sun, ISO 7) require teachesDays with 6 and 7.
    const seasons: AvailabilitySeason[] = [
      makeSeason({
        id: "school-year",
        name: "School year",
        startDate: "2025-01-01",
        teachesDays: [1, 2, 3, 4, 5, 6, 7],
        weekdayStartTime: "16:30",
        weekdayEndTime: "19:30",
        weekendStartTime: "16:30",
        weekendEndTime: "19:30",
      }),
      makeSeason({
        id: "summer",
        name: "Summer",
        startDate: "2025-06-01",
        teachesDays: [1, 2, 3, 4, 5, 6, 7],
        weekdayStartTime: "07:00",
        weekdayEndTime: "11:00",
        weekendStartTime: "07:00",
        weekendEndTime: "11:00",
      }),
    ];
    const nowUtc = new Date("2025-05-30T00:00:00.000Z");

    const summerSlots = computeAvailableSlots(
      makeBaseParams({ date: "2025-06-01", seasons, nowUtc }),
    );
    // First summer slot: 07:00 PDT = 14:00 UTC June 1
    expect(summerSlots[0]?.startsAt.toISOString()).toBe("2025-06-01T14:00:00.000Z");

    const schoolSlots = computeAvailableSlots(
      makeBaseParams({ date: "2025-05-31", seasons, nowUtc }),
    );
    // First school-year slot: 16:30 PDT = 23:30 UTC May 31
    expect(schoolSlots[0]?.startsAt.toISOString()).toBe("2025-05-31T23:30:00.000Z");
  });

  // ── Weekend vs weekday start ────────────────────────────────────────────────

  it("weekend start differs from weekday start: Saturday uses weekend_start_time, Friday uses weekday_start_time", () => {
    const season = makeSeason({
      startDate: "2025-01-01",
      teachesDays: [1, 2, 3, 4, 5, 6, 7],
      weekdayStartTime: "16:30",
      weekdayEndTime: "19:30",
      weekendStartTime: "13:00",
      weekendEndTime: "19:30",
    });
    const nowUtc = new Date("2025-09-15T00:00:00.000Z");

    // 2025-09-19 (Friday, ISO 5): weekday start
    const fridaySlots = computeAvailableSlots(
      makeBaseParams({ date: "2025-09-19", seasons: [season], nowUtc }),
    );
    // 2025-09-20 (Saturday, ISO 6): weekend start
    const saturdaySlots = computeAvailableSlots(
      makeBaseParams({ date: "2025-09-20", seasons: [season], nowUtc }),
    );

    // Friday first slot: 16:30 PDT = 23:30 UTC Sept 19
    expect(fridaySlots[0]?.startsAt.toISOString()).toBe("2025-09-19T23:30:00.000Z");
    // Saturday first slot: 13:00 PDT = 20:00 UTC Sept 20
    expect(saturdaySlots[0]?.startsAt.toISOString()).toBe("2025-09-20T20:00:00.000Z");
  });

  // ── Overrides ───────────────────────────────────────────────────────────────

  it("day_off override on a single date returns [] even when the season would be open", () => {
    const override = makeOverride({
      kind: "day_off",
      startDate: "2025-09-16",
      endDate: "2025-09-16",
    });
    const slots = computeAvailableSlots(makeBaseParams({ overrides: [override] }));
    expect(slots).toHaveLength(0);
  });

  it("day_off override across a date range (vacation) returns [] for every date in the range", () => {
    const override = makeOverride({
      kind: "day_off",
      startDate: "2025-09-15",
      endDate: "2025-09-19",
    });
    const nowUtc = new Date("2025-09-14T00:00:00.000Z");
    for (const date of ["2025-09-15", "2025-09-16", "2025-09-17", "2025-09-18", "2025-09-19"]) {
      const slots = computeAvailableSlots(
        makeBaseParams({ date, overrides: [override], nowUtc }),
      );
      expect(slots).toHaveLength(0);
    }
  });

  it("custom_hours override uses override's start/end regardless of the season window", () => {
    const override = makeOverride({
      kind: "custom_hours",
      startDate: "2025-09-16",
      endDate: "2025-09-16",
      startTime: "10:00",
      endTime: "12:00",
    });
    const slots = computeAvailableSlots(makeBaseParams({ overrides: [override] }));
    // First slot at 10:00 PDT = 17:00 UTC Sept 16
    expect(slots[0]?.startsAt.toISOString()).toBe("2025-09-16T17:00:00.000Z");
    // Last valid 30-min slot starts at 11:30 PDT = 18:30 UTC
    const lastSlot = slots[slots.length - 1];
    expect(lastSlot?.startsAt.toISOString()).toBe("2025-09-16T18:30:00.000Z");
  });

  it("blocked time inside a custom_hours override still removes that interval", () => {
    // custom_hours 10:00–12:00; blocked 10:30–11:00 PDT
    const override = makeOverride({
      kind: "custom_hours",
      startDate: "2025-09-16",
      endDate: "2025-09-16",
      startTime: "10:00",
      endTime: "12:00",
    });
    const blockedTimes = [
      {
        startsAt: new Date(Date.UTC(2025, 8, 16, 10 + 7, 30)), // 10:30 PDT
        endsAt: new Date(Date.UTC(2025, 8, 16, 11 + 7, 0)), // 11:00 PDT
      },
    ];
    const slots = computeAvailableSlots(makeBaseParams({ overrides: [override], blockedTimes }));
    const blockStart = Date.UTC(2025, 8, 16, 17, 30); // 10:30 PDT
    const blockEnd = Date.UTC(2025, 8, 16, 18, 0); // 11:00 PDT
    for (const slot of slots) {
      const t = slot.startsAt.getTime();
      // No slot STARTS inside the block, and no slot overlaps the block.
      expect(t + 30 * 60 * 1000 <= blockStart || t >= blockEnd).toBe(true);
    }
  });

  it("returns [] when no season covers the date (date is before earliest start_date)", () => {
    const seasons = [makeSeason({ startDate: "2025-06-01" })];
    const slots = computeAvailableSlots(
      makeBaseParams({
        date: "2025-05-31",
        seasons,
        nowUtc: new Date("2025-05-29T00:00:00.000Z"),
      }),
    );
    expect(slots).toHaveLength(0);
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
    const slotsWithLesson = computeAvailableSlots(
      makeBaseParams({
        existingLessons: [
          { startsAt: new Date(pdt("16:30")), durationMinutes: 30, locationId: "pool-A" },
        ],
      }),
    );
    const slotsWithout = computeAvailableSlots(makeBaseParams());

    expect(slotsWithLesson.some((s) => s.startsAt.getTime() === pdt("16:30"))).toBe(false);
    expect(slotsWithout.some((s) => s.startsAt.getTime() === pdt("16:30"))).toBe(true);
  });

  // ── Travel buffers ──────────────────────────────────────────────────────────

  it("back-to-back same-pool: no buffer gap, next slot starts immediately after lesson", () => {
    const lessonStart = new Date(pdt("16:30"));
    const slots = computeAvailableSlots(
      makeBaseParams({
        existingLessons: [{ startsAt: lessonStart, durationMinutes: 30, locationId: "pool-A" }],
      }),
    );
    expect(slots.some((s) => s.startsAt.getTime() === lessonStart.getTime())).toBe(false);
    expect(slots.some((s) => s.startsAt.toISOString() === "2025-09-17T00:00:00.000Z")).toBe(true);
  });

  it("different-pool lesson before: 30-min arrival buffer prevents slot starting too soon", () => {
    const lessonStart = new Date(pdt("16:30"));
    const slots = computeAvailableSlots(
      makeBaseParams({
        existingLessons: [{ startsAt: lessonStart, durationMinutes: 30, locationId: "pool-B" }],
        locationId: "pool-A",
      }),
    );
    const windowOpenMs = pdt("17:30");
    for (const slot of slots) {
      if (slot.startsAt.getTime() >= pdt("16:30")) {
        expect(slot.startsAt.getTime()).toBeGreaterThanOrEqual(windowOpenMs);
      }
    }
    expect(slots.some((s) => s.startsAt.toISOString() === "2025-09-17T00:30:00.000Z")).toBe(true);
  });

  it("different-pool lesson after: 30-min departure buffer prevents slot ending too late", () => {
    const lessonStart = new Date(pdt("18:00"));
    const slots = computeAvailableSlots(
      makeBaseParams({
        existingLessons: [{ startsAt: lessonStart, durationMinutes: 30, locationId: "pool-B" }],
        locationId: "pool-A",
      }),
    );
    expect(slots.some((s) => s.startsAt.toISOString() === "2025-09-17T00:00:00.000Z")).toBe(true);
    expect(slots.some((s) => s.startsAt.toISOString() === "2025-09-17T00:15:00.000Z")).toBe(false);
  });

  it("custom travel buffer override is respected over the 30-min default", () => {
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
    expect(slots.some((s) => s.startsAt.toISOString() === "2025-09-17T00:15:00.000Z")).toBe(true);
    expect(slots.some((s) => s.startsAt.toISOString() === "2025-09-17T00:00:00.000Z")).toBe(false);
  });

  // ── Daily lesson cap ────────────────────────────────────────────────────────

  it("returns empty when maxDailyLessonMinutes is fully committed", () => {
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
    const firstSlotMs = pdt("16:30");
    const nowUtc = new Date(firstSlotMs - 11 * 7 * 24 * 60 * 60 * 1000);
    const slots = computeAvailableSlots(makeBaseParams({ nowUtc }));
    expect(slots).toHaveLength(0);
  });

  // ── Blocked times ───────────────────────────────────────────────────────────

  it("blocked time removes that portion of the teaching window", () => {
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
  // March 9, 2025 is a Sunday (ISO 7); teachesDays must include 7.
  // Clocks spring 2 AM PST → 3 AM PDT (UTC transition: 10:00 UTC).
  // School-year window 16:30–19:30 PDT = 23:30 UTC Mar 9 → 02:30 UTC Mar 10.

  it("spring-forward day (2025-03-09, Sunday with teachesDays=[…,7]): 11 correct slots, no phantoms", () => {
    const seasons = [makeSeason({ teachesDays: [1, 2, 3, 5, 7] })];
    const slots = computeAvailableSlots(
      makeBaseParams({ date: "2025-03-09", seasons, nowUtc: new Date("2025-03-08T00:00:00.000Z") }),
    );
    expect(slots).toHaveLength(11);
    expect(slots[0]?.startsAt.toISOString()).toBe("2025-03-09T23:30:00.000Z"); // 16:30 PDT
    expect(slots[10]?.startsAt.toISOString()).toBe("2025-03-10T02:00:00.000Z"); // 19:00 PDT
    const startMs = slots.map((s) => s.startsAt.getTime());
    expect(new Set(startMs).size).toBe(startMs.length);
  });

  it("Friday before spring forward (2025-03-07, PST): 4:30 PM LA = 00:30 UTC next day", () => {
    const slots = computeAvailableSlots(
      makeBaseParams({ date: "2025-03-07", nowUtc: new Date("2025-03-06T00:00:00.000Z") }),
    );
    expect(slots[0]?.startsAt.toISOString()).toBe("2025-03-08T00:30:00.000Z");
  });

  it("Monday after spring forward (2025-03-10, PDT): 4:30 PM LA = 23:30 UTC same day", () => {
    const slots = computeAvailableSlots(
      makeBaseParams({ date: "2025-03-10", nowUtc: new Date("2025-03-09T00:00:00.000Z") }),
    );
    expect(slots[0]?.startsAt.toISOString()).toBe("2025-03-10T23:30:00.000Z");
  });

  it("advance window spanning PST→PDT: slot at UTC-15 h is excluded even when naive LA diff = 16 h", () => {
    const seasons = [makeSeason({ teachesDays: [1, 2, 3, 5, 7] })];
    const nowUtc = new Date("2025-03-09T08:30:00.000Z");
    const slots = computeAvailableSlots(makeBaseParams({ date: "2025-03-09", seasons, nowUtc }));
    expect(slots.some((s) => s.startsAt.toISOString() === "2025-03-09T23:30:00.000Z")).toBe(false);
    expect(slots.some((s) => s.startsAt.toISOString() === "2025-03-10T00:30:00.000Z")).toBe(true);
  });

  // ── DST — fall back (2025-11-02) ───────────────────────────────────────────

  it("fall-back day (2025-11-02, Sunday with teachesDays=[…,7]): 11 correct slots, no duplicates", () => {
    const seasons = [makeSeason({ teachesDays: [1, 2, 3, 5, 7] })];
    const slots = computeAvailableSlots(
      makeBaseParams({ date: "2025-11-02", seasons, nowUtc: new Date("2025-11-01T00:00:00.000Z") }),
    );
    expect(slots).toHaveLength(11);
    expect(slots[0]?.startsAt.toISOString()).toBe("2025-11-03T00:30:00.000Z"); // 16:30 PST
    expect(slots[10]?.startsAt.toISOString()).toBe("2025-11-03T03:00:00.000Z"); // 19:00 PST
    const startMs = slots.map((s) => s.startsAt.getTime());
    expect(new Set(startMs).size).toBe(startMs.length);
  });

  it("Friday before fall back (2025-10-31, PDT): 4:30 PM LA = 23:30 UTC same day", () => {
    const slots = computeAvailableSlots(
      makeBaseParams({ date: "2025-10-31", nowUtc: new Date("2025-10-30T00:00:00.000Z") }),
    );
    expect(slots[0]?.startsAt.toISOString()).toBe("2025-10-31T23:30:00.000Z");
  });

  it("Monday after fall back (2025-11-03, PST): 4:30 PM LA = 00:30 UTC next day", () => {
    const slots = computeAvailableSlots(
      makeBaseParams({ date: "2025-11-03", nowUtc: new Date("2025-11-02T00:00:00.000Z") }),
    );
    expect(slots[0]?.startsAt.toISOString()).toBe("2025-11-04T00:30:00.000Z");
  });

  it("advance window spanning PDT→PST: slot at UTC+16 h is included even when naive LA diff = 15 h", () => {
    const seasons = [makeSeason({ teachesDays: [1, 2, 3, 5, 7] })];
    const nowUtc = new Date("2025-11-02T08:30:00.000Z");
    const slots = computeAvailableSlots(makeBaseParams({ date: "2025-11-02", seasons, nowUtc }));
    expect(slots[0]?.startsAt.toISOString()).toBe("2025-11-03T00:30:00.000Z");
    const nowUtc1s = new Date("2025-11-02T08:30:01.000Z");
    const slots1s = computeAvailableSlots(
      makeBaseParams({ date: "2025-11-02", seasons, nowUtc: nowUtc1s }),
    );
    expect(slots1s[0]?.startsAt.toISOString()).toBe("2025-11-03T00:45:00.000Z");
  });
});

describe("classifyDaySlots", () => {
  // ── Closed day ──────────────────────────────────────────────────────────────

  it("returns [] for a day not in teachesDays", () => {
    const result = classifyDaySlots(
      makeBaseParams({ date: "2025-09-20", nowUtc: new Date("2025-09-19T00:00:00.000Z") }),
    );
    expect(result).toHaveLength(0);
  });

  it("returns [] when no season covers the date", () => {
    const seasons = [makeSeason({ startDate: "2025-06-01" })];
    const result = classifyDaySlots(
      makeBaseParams({
        date: "2025-05-31",
        seasons,
        nowUtc: new Date("2025-05-29T00:00:00.000Z"),
      }),
    );
    expect(result).toHaveLength(0);
  });

  // ── Returns all slots (not just available) ──────────────────────────────────

  it("returns all teaching-window slots, not only available ones", () => {
    const blockedTimes = [
      { startsAt: new Date(pdt("16:30")), endsAt: new Date(pdt("17:00")) },
    ];
    const result = classifyDaySlots(makeBaseParams({ blockedTimes }));

    const availableCount = result.filter((s) => s.state === "available").length;
    const unavailableCount = result.filter((s) => s.state === "unavailable").length;
    expect(unavailableCount).toBeGreaterThan(0);
    expect(availableCount).toBeGreaterThan(0);
    expect(result.length).toBeGreaterThan(availableCount);
  });

  // ── Slot states ─────────────────────────────────────────────────────────────

  it("a blocked slot is 'unavailable'", () => {
    const blocked = [{ startsAt: new Date(pdt("16:30")), endsAt: new Date(pdt("17:00")) }];
    const result = classifyDaySlots(makeBaseParams({ blockedTimes: blocked }));
    const slot = result.find((s) => s.startsAt === new Date(pdt("16:30")).toISOString());
    expect(slot?.state).toBe("unavailable");
  });

  it("slot exactly at nowUtc + bookingMinAdvanceHours is 'available'", () => {
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
    const nowUtc = new Date(pdt("17:30"));
    const result = classifyDaySlots(makeBaseParams({ nowUtc }));
    const pastSlots = result.filter((s) => s.state === "past");
    expect(pastSlots.length).toBeGreaterThan(0);
    const firstSlot = result.find((s) => s.startsAt === new Date(pdt("16:30")).toISOString());
    expect(firstSlot?.state).toBe("past");
  });

  it("slot beyond bookingMaxAdvanceWeeks is 'not_open_yet'", () => {
    const firstSlotMs = pdt("16:30");
    const nowUtc = new Date(firstSlotMs - 11 * 7 * 24 * 60 * 60 * 1000);
    const result = classifyDaySlots(makeBaseParams({ nowUtc }));
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((s) => s.state === "not_open_yet")).toBe(true);
  });

  // ── Daily cap ───────────────────────────────────────────────────────────────

  it("when daily cap is reached, non-past/non-too_soon slots become 'unavailable'", () => {
    const base = pdt("16:30");
    const hourMs = 60 * 60 * 1000;
    const existingLessons = [0, 1, 2, 3].map((index) => ({
      startsAt: new Date(base + index * hourMs),
      durationMinutes: 60,
      locationId: "pool-A",
    }));
    const result = classifyDaySlots(makeBaseParams({ existingLessons, durationMinutes: 30 }));
    expect(result.length).toBeGreaterThan(0);
    for (const slot of result) {
      expect(["unavailable", "past", "too_soon"]).toContain(slot.state);
    }
  });

  // ── excludeLessonId behavior ────────────────────────────────────────────────

  it("passing existingLessons without the excluded lesson frees its slot", () => {
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

  // ── Override handling ──────────────────────────────────────────────────────

  it("day_off override returns [] regardless of lesson day", () => {
    const override = makeOverride({
      kind: "day_off",
      startDate: "2025-09-16",
      endDate: "2025-09-16",
    });
    const result = classifyDaySlots(makeBaseParams({ overrides: [override] }));
    expect(result).toHaveLength(0);
  });

  // ── DST — spring forward (2025-03-09) ──────────────────────────────────────

  it("spring-forward week: classifyDaySlots on 2025-03-09 returns 11 slots with correct UTC starts", () => {
    const seasons = [makeSeason({ teachesDays: [1, 2, 3, 5, 7] })];
    const nowUtc = new Date("2025-03-08T00:00:00.000Z");
    const result = classifyDaySlots(makeBaseParams({ date: "2025-03-09", seasons, nowUtc }));
    expect(result).toHaveLength(11);
    expect(result[0]?.startsAt).toBe("2025-03-09T23:30:00.000Z");
    expect(result[10]?.startsAt).toBe("2025-03-10T02:00:00.000Z");
    const starts = result.map((s) => s.startsAt);
    expect(new Set(starts).size).toBe(starts.length);
  });

  // ── DST — fall back (2025-11-02) ───────────────────────────────────────────

  it("fall-back week: classifyDaySlots on 2025-11-02 returns 11 slots with no duplicates", () => {
    const seasons = [makeSeason({ teachesDays: [1, 2, 3, 5, 7] })];
    const nowUtc = new Date("2025-11-01T00:00:00.000Z");
    const result = classifyDaySlots(makeBaseParams({ date: "2025-11-02", seasons, nowUtc }));
    expect(result).toHaveLength(11);
    expect(result[0]?.startsAt).toBe("2025-11-03T00:30:00.000Z");
    expect(result[10]?.startsAt).toBe("2025-11-03T03:00:00.000Z");
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
