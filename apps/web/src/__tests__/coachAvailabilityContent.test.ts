import { describe, it, expect } from "vitest";
import { upcomingSummary } from "../content/CoachAvailabilityContent/seasonSummary";
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

describe("upcomingSummary", () => {
  it("includes 'weekdays' and 'ends' when weekdayStartTime and weekdayEndTime are set", () => {
    const season = makeSeason({
      weekdayStartTime: "15:00",
      weekdayEndTime: "20:00",
    });
    const result = upcomingSummary(season);
    expect(result).toContain("weekdays");
    expect(result).toContain("ends");
  });

  it("does not include 'ends' when both end times are null", () => {
    const season = makeSeason({
      weekdayStartTime: "15:00",
      weekdayEndTime: null,
      weekendStartTime: null,
      weekendEndTime: null,
    });
    const result = upcomingSummary(season);
    expect(result).not.toContain("ends");
  });

  it("includes 'weekends' when weekendStartTime differs from weekdayStartTime", () => {
    const season = makeSeason({
      weekdayStartTime: "15:00",
      weekdayEndTime: "20:00",
      weekendStartTime: "09:00",
      weekendEndTime: "20:00",
    });
    const result = upcomingSummary(season);
    expect(result).toContain("weekends");
  });

  it("does not duplicate weekend when weekendStartTime equals weekdayStartTime", () => {
    const season = makeSeason({
      weekdayStartTime: "15:00",
      weekdayEndTime: "20:00",
      weekendStartTime: "15:00",
      weekendEndTime: "20:00",
    });
    const result = upcomingSummary(season);
    expect(result).not.toContain("weekends");
  });
});
