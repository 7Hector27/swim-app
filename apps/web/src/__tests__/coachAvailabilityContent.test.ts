import { describe, it, expect } from "vitest";
import {
  formatSeasonTitle,
  formatWeekdayLine,
  formatWeekendLine,
} from "../content/CoachAvailabilityContent/seasonSummary";
import type { SeasonWithIsCurrent } from "@swim-app/shared";

function makeSeason(overrides: Partial<SeasonWithIsCurrent> = {}): SeasonWithIsCurrent {
  return {
    id: "aaaaaaaa-0000-0000-0000-000000000001",
    name: "Test Season",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    teachesDays: [1, 2, 3, 4, 5],
    weekdayStartTime: null,
    weekdayEndTime: null,
    weekendStartTime: null,
    weekendEndTime: null,
    startsAtDst: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    isCurrent: false,
    ...overrides,
  };
}

describe("formatSeasonTitle", () => {
  it("joins the season name with its start and end dates using 'to'", () => {
    const season = makeSeason({
      name: "November",
      startDate: "2026-11-01",
      endDate: "2026-11-30",
    });
    expect(formatSeasonTitle(season)).toBe("November · Nov 1 to Nov 30");
  });

  it("falls back to 'from <start>' when the end date is missing", () => {
    // Empty string is not valid per the schema, but the formatter should
    // still produce a readable title instead of 'Nov 1 to ' or a crash.
    const season = makeSeason({
      name: "Open-ended",
      startDate: "2026-11-01",
      endDate: "",
    });
    expect(formatSeasonTitle(season)).toBe("Open-ended · from Nov 1");
  });
});

describe("formatWeekdayLine", () => {
  it("renders the weekday range with 'to' when 3+ contiguous days are set", () => {
    const season = makeSeason({
      teachesDays: [2, 3, 4, 5], // Tue to Fri
      weekdayStartTime: "14:00",
      weekdayEndTime: "20:00",
    });
    expect(formatWeekdayLine(season)).toBe(
      "Weekdays (Tue to Fri): 2:00 pm to 8:00 pm",
    );
  });

  it("falls back to commas when the weekday selection is not contiguous", () => {
    const season = makeSeason({
      teachesDays: [1, 3, 5], // Mon, Wed, Fri
      weekdayStartTime: "14:00",
      weekdayEndTime: "20:00",
    });
    expect(formatWeekdayLine(season)).toBe(
      "Weekdays (Mon, Wed, Fri): 2:00 pm to 8:00 pm",
    );
  });

  it("renders 'Weekdays: off' when no weekday hours or days are set", () => {
    const season = makeSeason({
      teachesDays: [6, 7],
      weekdayStartTime: null,
      weekdayEndTime: null,
    });
    expect(formatWeekdayLine(season)).toBe("Weekdays: off");
  });
});

describe("formatWeekendLine", () => {
  it("renders 'Weekends (Sat, Sun)' with the time range when both are set", () => {
    const season = makeSeason({
      teachesDays: [6, 7],
      weekendStartTime: "11:00",
      weekendEndTime: "16:00",
    });
    expect(formatWeekendLine(season)).toBe(
      "Weekends (Sat, Sun): 11:00 am to 4:00 pm",
    );
  });

  it("renders a single weekend day when only one is taught", () => {
    const season = makeSeason({
      teachesDays: [6],
      weekendStartTime: "11:00",
      weekendEndTime: "16:00",
    });
    expect(formatWeekendLine(season)).toBe(
      "Weekends (Sat): 11:00 am to 4:00 pm",
    );
  });

  it("renders 'Weekends: off' when no weekend hours are set", () => {
    const season = makeSeason({
      teachesDays: [1, 2, 3, 4, 5],
      weekendStartTime: null,
      weekendEndTime: null,
    });
    expect(formatWeekendLine(season)).toBe("Weekends: off");
  });
});
