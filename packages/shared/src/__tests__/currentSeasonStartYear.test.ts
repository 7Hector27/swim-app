import { vi, describe, it, expect, afterEach } from "vitest";
import { currentSeasonStartYear, CLUB_SEASON_START_MONTH } from "../lib/currentSeasonStartYear";
import { todayLA } from "../lib/todayLA";

describe("summer_league", () => {
  it("returns the calendar year regardless of month", () => {
    expect(currentSeasonStartYear("summer_league", "2026-01-01")).toBe(2026);
    expect(currentSeasonStartYear("summer_league", "2026-06-15")).toBe(2026);
    expect(currentSeasonStartYear("summer_league", "2026-12-31")).toBe(2026);
  });

  it("rolls over at Jan 1", () => {
    expect(currentSeasonStartYear("summer_league", "2025-12-31")).toBe(2025);
    expect(currentSeasonStartYear("summer_league", "2026-01-01")).toBe(2026);
  });
});

describe("club — before, on, and after CLUB_SEASON_START_MONTH", () => {
  const startMonth = String(CLUB_SEASON_START_MONTH).padStart(2, "0");
  const beforeMonth = String(CLUB_SEASON_START_MONTH - 1).padStart(2, "0");

  it("returns the current year on the first day of the start month", () => {
    expect(currentSeasonStartYear("club", `2026-${startMonth}-01`)).toBe(2026);
  });

  it("returns the current year after the start month", () => {
    expect(currentSeasonStartYear("club", "2026-12-31")).toBe(2026);
    expect(currentSeasonStartYear("club", `2026-${startMonth}-30`)).toBe(2026);
  });

  it("returns the previous year before the start month", () => {
    expect(currentSeasonStartYear("club", `2026-${beforeMonth}-30`)).toBe(2025);
    expect(currentSeasonStartYear("club", "2026-01-01")).toBe(2025);
  });

  it("handles year boundary: Jan 1 is still the prior season", () => {
    expect(currentSeasonStartYear("club", "2027-01-01")).toBe(2026);
  });
});

describe("currentSeasonStartYear + todayLA near LA midnight at club season boundary", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("UTC has crossed into the start month but LA has not → prior season", () => {
    // CLUB_SEASON_START_MONTH = 9 (Sep). Sep 1 00:00 UTC = Aug 31 ~5 PM LA (UTC-7).
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T00:00:00Z"));
    expect(todayLA()).toBe("2026-08-31");
    expect(currentSeasonStartYear("club", todayLA())).toBe(2025);
  });

  it("once LA crosses into the start month → new season begins", () => {
    // Sep 1 08:00 UTC = Sep 1 01:00 LA (UTC-7).
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T08:00:00Z"));
    expect(todayLA()).toBe("2026-09-01");
    expect(currentSeasonStartYear("club", todayLA())).toBe(2026);
  });
});
