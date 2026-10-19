import { describe, it, expect } from "vitest";
import { computeImpactWarnings, dstStartDate, type UpcomingLessonForWarning } from "../lib/availabilityWarnings";
import type { AvailabilitySeason, AvailabilityOverride } from "@swim-app/shared";
import type { DefaultHours } from "../lib/effectiveHours";

describe("dstStartDate (second Sunday of March)", () => {
  it("returns 2024-03-10 for 2024", () => {
    expect(dstStartDate(2024)).toBe("2024-03-10");
  });

  it("returns 2025-03-09 for 2025", () => {
    expect(dstStartDate(2025)).toBe("2025-03-09");
  });

  it("returns 2026-03-08 for 2026", () => {
    expect(dstStartDate(2026)).toBe("2026-03-08");
  });

  it("returns 2027-03-14 for 2027", () => {
    expect(dstStartDate(2027)).toBe("2027-03-14");
  });
});

// -- Fixtures -----------------------------------------------------------------
// 2026-07-15 is a Wednesday (ISO 3). July is PDT (UTC-7).
// To get LA wall time: add 7h to UTC (e.g. 17:00Z = 10:00 PDT; 00:00Z next day = 17:00 PDT).

const WIDE_DEFAULTS: DefaultHours = {
  defaultTeachesDays: [1, 2, 3, 4, 5, 6, 7],
  defaultStartTime: "09:00",
  defaultEndTime: "20:00",
};

const NARROW_DEFAULTS: DefaultHours = {
  defaultTeachesDays: [1, 2, 3, 4, 5],
  defaultStartTime: "16:00",
  defaultEndTime: "20:00",
};

const makeLesson = (utcIso: string, durationMinutes = 60): UpcomingLessonForWarning => ({
  id: utcIso,
  startsAt: new Date(utcIso),
  durationMinutes,
  swimmerFirstNames: ["Alice"],
  poolName: "Main Pool",
});

// 10:00–11:00 PDT on 2026-07-15 (Wed) — fits narrow 09:00–12:00 window
const MORNING = makeLesson("2026-07-15T17:00:00Z");
// 17:00–18:00 PDT on 2026-07-15 (Wed) — fits wide 09:00–20:00, outside narrow 09:00–12:00
const AFTERNOON = makeLesson("2026-07-16T00:00:00Z");
// 10:00–11:00 PDT on 2026-09-15 (Tue) — outside the Jul–Aug season range
const OUTSIDE_RANGE = makeLesson("2026-09-15T17:00:00Z");

const makeSeason = (overrides: Partial<AvailabilitySeason> = {}): AvailabilitySeason => ({
  id: "s1",
  name: "Summer",
  startDate: "2026-07-01",
  endDate: "2026-08-31",
  teachesDays: [1, 2, 3, 4, 5],
  weekdayStartTime: "09:00",
  weekdayEndTime: "20:00",
  weekendStartTime: null,
  weekendEndTime: null,
  startsAtDst: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

const makeOverride = (overrides: Partial<AvailabilityOverride> = {}): AvailabilityOverride => ({
  id: "o1",
  kind: "custom_hours",
  startDate: "2026-07-15",
  endDate: "2026-07-15",
  startTime: "09:00",
  endTime: "20:00",
  note: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

const WIDE_SEASON = makeSeason();                               // 09:00–20:00 weekdays
const NARROW_SEASON = makeSeason({ weekdayEndTime: "12:00" }); // 09:00–12:00 weekdays

describe("computeImpactWarnings", () => {
  // ── Season create ─────────────────────────────────────────────────────────

  describe("season create", () => {
    it("does not flag a lesson outside the season's date range", () => {
      const warnings = computeImpactWarnings(
        [OUTSIDE_RANGE], [], [], [NARROW_SEASON], [], WIDE_DEFAULTS,
      );
      expect(warnings).toEqual([]);
    });

    it("does not flag a lesson inside the range that still fits new hours", () => {
      const warnings = computeImpactWarnings(
        [MORNING], [], [], [NARROW_SEASON], [], WIDE_DEFAULTS,
      );
      expect(warnings).toEqual([]);
    });

    it("flags a lesson inside the range that no longer fits new hours", () => {
      const warnings = computeImpactWarnings(
        [AFTERNOON], [], [], [NARROW_SEASON], [], WIDE_DEFAULTS,
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0]!.reason).toBe("outside_hours");
      expect(warnings[0]!.lessonId).toBe(AFTERNOON.id);
    });

    it("flags with reason day_closed when the new season excludes the lesson's weekday", () => {
      const closedSeason = makeSeason({ teachesDays: [2, 4, 5, 6, 7] }); // excludes Wed (ISO 3)
      const warnings = computeImpactWarnings(
        [MORNING], [], [], [closedSeason], [], WIDE_DEFAULTS,
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0]!.reason).toBe("day_closed");
    });
  });

  // ── Season edit ───────────────────────────────────────────────────────────

  describe("season edit", () => {
    it("does not flag a lesson outside the season's date range", () => {
      const warnings = computeImpactWarnings(
        [OUTSIDE_RANGE], [WIDE_SEASON], [], [NARROW_SEASON], [], WIDE_DEFAULTS,
      );
      expect(warnings).toEqual([]);
    });

    it("does not flag a lesson that still fits the narrowed hours", () => {
      const warnings = computeImpactWarnings(
        [MORNING], [WIDE_SEASON], [], [NARROW_SEASON], [], WIDE_DEFAULTS,
      );
      expect(warnings).toEqual([]);
    });

    it("flags a lesson that no longer fits after hours are narrowed", () => {
      const warnings = computeImpactWarnings(
        [AFTERNOON], [WIDE_SEASON], [], [NARROW_SEASON], [], WIDE_DEFAULTS,
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0]!.reason).toBe("outside_hours");
    });

    it("flags with day_closed when the edited season removes the lesson's weekday", () => {
      // Before: WIDE_SEASON teaches Mon–Fri (includes Wed). After: Wed dropped from teachesDays.
      // An active season that excludes a day closes it — defaults are not consulted as a fallback.
      const noWedSeason = makeSeason({ teachesDays: [1, 2, 4, 5] }); // Mon,Tue,Thu,Fri
      const warnings = computeImpactWarnings(
        [MORNING], [WIDE_SEASON], [], [noWedSeason], [], WIDE_DEFAULTS,
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0]!.reason).toBe("day_closed");
    });
  });

  // ── Season delete ─────────────────────────────────────────────────────────

  describe("season delete", () => {
    it("does not flag a lesson outside the deleted season's date range", () => {
      const warnings = computeImpactWarnings(
        [OUTSIDE_RANGE], [WIDE_SEASON], [], [], [], WIDE_DEFAULTS,
      );
      expect(warnings).toEqual([]);
    });

    it("does not flag a lesson that still fits via defaults after deletion", () => {
      const warnings = computeImpactWarnings(
        [MORNING], [WIDE_SEASON], [], [], [], WIDE_DEFAULTS,
      );
      expect(warnings).toEqual([]);
    });

    it("flags a lesson whose defaults no longer cover it after deletion", () => {
      // NARROW_DEFAULTS = 16:00–20:00; morning lesson at 10:00 no longer fits
      const warnings = computeImpactWarnings(
        [MORNING], [WIDE_SEASON], [], [], [], NARROW_DEFAULTS,
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0]!.reason).toBe("outside_hours");
    });
  });

  // ── Override (one-off) create ─────────────────────────────────────────────

  describe("override create", () => {
    it("does not flag a lesson outside the override's date range", () => {
      const dayOff = makeOverride({ kind: "day_off", startTime: null, endTime: null });
      const warnings = computeImpactWarnings(
        [OUTSIDE_RANGE], [WIDE_SEASON], [], [WIDE_SEASON], [dayOff], WIDE_DEFAULTS,
      );
      expect(warnings).toEqual([]);
    });

    it("does not flag a lesson on the override date that still fits custom hours", () => {
      const customWide = makeOverride({ kind: "custom_hours", startTime: "09:00", endTime: "20:00" });
      const warnings = computeImpactWarnings(
        [MORNING], [WIDE_SEASON], [], [WIDE_SEASON], [customWide], WIDE_DEFAULTS,
      );
      expect(warnings).toEqual([]);
    });

    it("flags a lesson on the override date when the day is closed", () => {
      const dayOff = makeOverride({ kind: "day_off", startTime: null, endTime: null });
      const warnings = computeImpactWarnings(
        [MORNING], [WIDE_SEASON], [], [WIDE_SEASON], [dayOff], WIDE_DEFAULTS,
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0]!.reason).toBe("day_closed");
    });

    it("flags a lesson on the override date that fit the season but not the narrow custom hours", () => {
      // AFTERNOON (17:00–18:00) fits WIDE_SEASON (09:00–20:00) before the override is added.
      // A narrow custom_hours override (09:00–12:00) takes precedence over the season,
      // so the lesson no longer fits and is flagged outside_hours.
      const narrowCustom = makeOverride({ kind: "custom_hours", startTime: "09:00", endTime: "12:00" });
      const warnings = computeImpactWarnings(
        [AFTERNOON], [WIDE_SEASON], [], [WIDE_SEASON], [narrowCustom], WIDE_DEFAULTS,
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0]!.reason).toBe("outside_hours");
    });
  });

  // ── Override (one-off) edit ───────────────────────────────────────────────

  describe("override edit", () => {
    const wideOverride = makeOverride({ id: "o1", kind: "custom_hours", startTime: "09:00", endTime: "20:00" });
    const narrowOverride = makeOverride({ id: "o1", kind: "custom_hours", startTime: "09:00", endTime: "12:00" });

    it("does not flag a lesson outside the override's date range", () => {
      const warnings = computeImpactWarnings(
        [OUTSIDE_RANGE], [WIDE_SEASON], [wideOverride], [WIDE_SEASON], [narrowOverride], WIDE_DEFAULTS,
      );
      expect(warnings).toEqual([]);
    });

    it("does not flag a lesson that still fits the narrowed custom hours", () => {
      const warnings = computeImpactWarnings(
        [MORNING], [WIDE_SEASON], [wideOverride], [WIDE_SEASON], [narrowOverride], WIDE_DEFAULTS,
      );
      expect(warnings).toEqual([]);
    });

    it("flags a lesson that no longer fits after custom hours are narrowed", () => {
      const warnings = computeImpactWarnings(
        [AFTERNOON], [WIDE_SEASON], [wideOverride], [WIDE_SEASON], [narrowOverride], WIDE_DEFAULTS,
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0]!.reason).toBe("outside_hours");
    });
  });

  // ── Override (one-off) delete ─────────────────────────────────────────────

  describe("override delete", () => {
    // Before: wide custom_hours override on Jul 15. After: no override; NARROW_SEASON applies.
    const wideOverride = makeOverride({ kind: "custom_hours", startTime: "09:00", endTime: "20:00" });

    it("does not flag a lesson outside the deleted override's date range", () => {
      const warnings = computeImpactWarnings(
        [OUTSIDE_RANGE], [NARROW_SEASON], [wideOverride], [NARROW_SEASON], [], WIDE_DEFAULTS,
      );
      expect(warnings).toEqual([]);
    });

    it("does not flag a lesson that still fits the underlying season after deletion", () => {
      // MORNING (10am) fits both the override (09:00–20:00) and NARROW_SEASON (09:00–12:00)
      const warnings = computeImpactWarnings(
        [MORNING], [NARROW_SEASON], [wideOverride], [NARROW_SEASON], [], WIDE_DEFAULTS,
      );
      expect(warnings).toEqual([]);
    });

    it("flags a lesson that fit the override but not the underlying season after deletion", () => {
      // AFTERNOON (5pm) fit the wide override but not NARROW_SEASON (09:00–12:00)
      const warnings = computeImpactWarnings(
        [AFTERNOON], [NARROW_SEASON], [wideOverride], [NARROW_SEASON], [], WIDE_DEFAULTS,
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0]!.reason).toBe("outside_hours");
    });
  });
});
