import { describe, it, expect } from "vitest";
import { effectiveHours, type DefaultHours } from "../lib/effectiveHours";
import type { AvailabilitySeason, AvailabilityOverride } from "@swim-app/shared";

const DEFAULTS: DefaultHours = {
  defaultTeachesDays: [2, 3, 4, 5],
  defaultStartTime: "16:00",
  defaultEndTime: "20:00",
};

const makeSeason = (overrides: Partial<AvailabilitySeason> = {}): AvailabilitySeason => ({
  id: "season-x",
  name: "Season X",
  startDate: "2026-06-01",
  teachesDays: [1, 2, 3, 4, 5, 6, 7],
  weekdayStartTime: "17:00",
  weekdayEndTime: "21:00",
  weekendStartTime: "17:00",
  weekendEndTime: "21:00",
  startsAtDst: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

const makeOverride = (overrides: Partial<AvailabilityOverride> = {}): AvailabilityOverride => ({
  id: "override-x",
  kind: "day_off",
  startDate: "2026-07-15",
  endDate: "2026-07-15",
  startTime: null,
  endTime: null,
  note: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

describe("effectiveHours", () => {
  it("selects the latest season whose start_date <= date", () => {
    const seasons = [
      makeSeason({ id: "s1", startDate: "2026-06-01", weekdayStartTime: "17:00", weekdayEndTime: "21:00" }),
      makeSeason({ id: "s2", startDate: "2026-08-15", weekdayStartTime: "16:45", weekdayEndTime: "20:30" }),
      makeSeason({ id: "s3", startDate: "2026-09-15", weekdayStartTime: "16:00", weekdayEndTime: "19:30" }),
    ];
    // 2026-08-17 (Mon) → s2 is active
    expect(effectiveHours("2026-08-17", seasons, [])).toEqual([{ start: "16:45", end: "20:30" }]);
    // 2026-09-15 (Tue, boundary day) → s3 is active
    expect(effectiveHours("2026-09-15", seasons, [])).toEqual([{ start: "16:00", end: "19:30" }]);
    // 2026-08-14 (Fri, day before s2) → s1 still active
    expect(effectiveHours("2026-08-14", seasons, [])).toEqual([{ start: "17:00", end: "21:00" }]);
  });

  it("returns [] when teaches_days excludes the date's weekday", () => {
    // 2026-06-01 is a Monday (ISO 1). teachesDays=[2..7] excludes Monday.
    const season = makeSeason({ teachesDays: [2, 3, 4, 5, 6, 7] });
    expect(effectiveHours("2026-06-01", [season], [])).toEqual([]);
  });

  it("uses weekend_start_time on Saturdays and Sundays, weekday_start_time otherwise", () => {
    const season = makeSeason({
      startDate: "2026-11-01",
      weekdayStartTime: "14:30",
      weekdayEndTime: "17:30",
      weekendStartTime: "13:00",
      weekendEndTime: "17:30",
    });
    // 2026-11-07 is a Saturday (ISO 6)
    expect(effectiveHours("2026-11-07", [season], [])).toEqual([{ start: "13:00", end: "17:30" }]);
    // 2026-11-08 is a Sunday (ISO 7)
    expect(effectiveHours("2026-11-08", [season], [])).toEqual([{ start: "13:00", end: "17:30" }]);
    // 2026-11-06 is a Friday (ISO 5)
    expect(effectiveHours("2026-11-06", [season], [])).toEqual([{ start: "14:30", end: "17:30" }]);
  });

  it("returns [] when the weekday-vs-weekend start_time is null for the day", () => {
    // teaches_days contains weekend days but weekend_start_time is null → CLOSED on weekend.
    const season = makeSeason({
      teachesDays: [1, 2, 3, 4, 5, 6, 7],
      weekdayStartTime: "17:00",
      weekdayEndTime: "21:00",
      weekendStartTime: null,
      weekendEndTime: null,
    });
    // 2026-06-06 is Saturday
    expect(effectiveHours("2026-06-06", [season], [])).toEqual([]);
    // 2026-06-05 is Friday
    expect(effectiveHours("2026-06-05", [season], [])).toEqual([{ start: "17:00", end: "21:00" }]);
  });

  it("day_off override on a single date returns [] even when the season would be open", () => {
    const season = makeSeason();
    const override = makeOverride({
      kind: "day_off",
      startDate: "2026-07-15",
      endDate: "2026-07-15",
    });
    expect(effectiveHours("2026-07-15", [season], [override])).toEqual([]);
    // Day before and after use the season window
    expect(effectiveHours("2026-07-14", [season], [override])).toEqual([{ start: "17:00", end: "21:00" }]);
    expect(effectiveHours("2026-07-16", [season], [override])).toEqual([{ start: "17:00", end: "21:00" }]);
  });

  it("day_off override across a date range returns [] for every date in the range", () => {
    const season = makeSeason();
    const override = makeOverride({
      kind: "day_off",
      startDate: "2026-07-10",
      endDate: "2026-07-20",
    });
    for (let day = 10; day <= 20; day++) {
      const date = `2026-07-${String(day).padStart(2, "0")}`;
      expect(effectiveHours(date, [season], [override])).toEqual([]);
    }
    expect(effectiveHours("2026-07-09", [season], [override])).toEqual([{ start: "17:00", end: "21:00" }]);
    expect(effectiveHours("2026-07-21", [season], [override])).toEqual([{ start: "17:00", end: "21:00" }]);
  });

  it("custom_hours override replaces the season window on that date", () => {
    const season = makeSeason({ weekdayStartTime: "17:00", weekdayEndTime: "21:00" });
    const override = makeOverride({
      kind: "custom_hours",
      startDate: "2026-07-15",
      endDate: "2026-07-15",
      startTime: "09:00",
      endTime: "12:00",
    });
    expect(effectiveHours("2026-07-15", [season], [override])).toEqual([
      { start: "09:00", end: "12:00" },
    ]);
    // Adjacent date still uses the season window
    expect(effectiveHours("2026-07-16", [season], [override])).toEqual([
      { start: "17:00", end: "21:00" },
    ]);
  });

  it("returns [] (CLOSED) when no season covers the date", () => {
    const seasons = [makeSeason({ startDate: "2026-06-01" })];
    // Date is before earliest season start_date
    expect(effectiveHours("2026-05-31", seasons, [])).toEqual([]);
  });

  it("normalizes HH:MM:SS DB time strings to HH:MM", () => {
    const season = makeSeason({
      weekdayStartTime: "16:30:00" as unknown as string,
      weekdayEndTime: "19:30:00" as unknown as string,
      weekendStartTime: "16:30:00" as unknown as string,
      weekendEndTime: "19:30:00" as unknown as string,
    });
    expect(effectiveHours("2026-06-02", [season], [])).toEqual([{ start: "16:30", end: "19:30" }]);
  });

  it("override wins over season — custom_hours applied even when teaches_days would exclude the weekday", () => {
    // teaches_days = Monday only; override 2026-06-06 (Saturday) uses custom_hours
    const season = makeSeason({ teachesDays: [1] });
    const override = makeOverride({
      kind: "custom_hours",
      startDate: "2026-06-06",
      endDate: "2026-06-06",
      startTime: "10:00",
      endTime: "12:00",
    });
    expect(effectiveHours("2026-06-06", [season], [override])).toEqual([
      { start: "10:00", end: "12:00" },
    ]);
  });

  it("uses weekendEndTime on Saturday/Sunday and weekdayEndTime on weekdays", () => {
    const season = makeSeason({
      startDate: "2026-11-01",
      teachesDays: [1, 2, 3, 4, 5, 6, 7],
      weekdayStartTime: "16:00",
      weekdayEndTime: "20:00",
      weekendStartTime: "13:00",
      weekendEndTime: "17:00",
    });
    // 2026-11-07 is Saturday (ISO 6)
    expect(effectiveHours("2026-11-07", [season], [])).toEqual([{ start: "13:00", end: "17:00" }]);
    // 2026-11-08 is Sunday (ISO 7)
    expect(effectiveHours("2026-11-08", [season], [])).toEqual([{ start: "13:00", end: "17:00" }]);
    // 2026-11-06 is Friday (ISO 5)
    expect(effectiveHours("2026-11-06", [season], [])).toEqual([{ start: "16:00", end: "20:00" }]);
  });

  // ── Default hours fallback ──────────────────────────────────────────────────

  it("uses the default hours on a date before any season starts", () => {
    const season = makeSeason({ startDate: "2026-06-01" });
    // 2026-05-26 is a Tuesday — included in defaults [2,3,4,5]
    expect(effectiveHours("2026-05-26", [season], [], DEFAULTS)).toEqual([
      { start: "16:00", end: "20:00" },
    ]);
  });

  it("defaults close the day on Monday and Saturday", () => {
    // Monday: 2026-05-25 (ISO 1)
    expect(effectiveHours("2026-05-25", [], [], DEFAULTS)).toEqual([]);
    // Saturday: 2026-05-30 (ISO 6)
    expect(effectiveHours("2026-05-30", [], [], DEFAULTS)).toEqual([]);
    // Sunday: 2026-05-31 (ISO 7)
    expect(effectiveHours("2026-05-31", [], [], DEFAULTS)).toEqual([]);
  });

  it("the season wins over defaults from its start_date onward", () => {
    const season = makeSeason({
      startDate: "2026-06-01",
      weekdayStartTime: "17:00",
      weekdayEndTime: "21:00",
      weekendStartTime: "17:00",
      weekendEndTime: "21:00",
    });
    // Day before season starts: 2026-05-26 (Tue) uses defaults
    expect(effectiveHours("2026-05-26", [season], [], DEFAULTS)).toEqual([
      { start: "16:00", end: "20:00" },
    ]);
    // Start date and beyond use the season window
    expect(effectiveHours("2026-06-02", [season], [], DEFAULTS)).toEqual([
      { start: "17:00", end: "21:00" },
    ]);
  });

  it("override still wins when only defaults apply", () => {
    const override = makeOverride({
      kind: "custom_hours",
      startDate: "2026-05-25",
      endDate: "2026-05-25",
      startTime: "09:00",
      endTime: "11:00",
    });
    // 2026-05-25 (Mon) is closed by defaults, but the override replaces it.
    expect(effectiveHours("2026-05-25", [], [override], DEFAULTS)).toEqual([
      { start: "09:00", end: "11:00" },
    ]);
  });

  it("without defaults, a date before any season is closed", () => {
    const season = makeSeason({ startDate: "2026-06-01" });
    expect(effectiveHours("2026-05-26", [season], [])).toEqual([]);
    expect(effectiveHours("2026-05-26", [season], [], null)).toEqual([]);
  });
});
