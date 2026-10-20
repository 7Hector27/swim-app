import { describe, it, expect } from "vitest";
import { addDays, mondayOf, weekDates, dayViewLabel, weekRangeLabel } from "../lib/calendarDate";

describe("addDays", () => {
  it("adds positive days", () => {
    expect(addDays("2026-10-19", 1)).toBe("2026-10-20");
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("subtracts days", () => {
    expect(addDays("2026-10-20", -1)).toBe("2026-10-19");
    expect(addDays("2026-11-01", -1)).toBe("2026-10-31");
  });
  it("adds zero days", () => {
    expect(addDays("2026-10-19", 0)).toBe("2026-10-19");
  });
  it("is stable across US spring-forward (2026-03-08)", () => {
    expect(addDays("2026-03-07", 1)).toBe("2026-03-08");
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
  });
  it("is stable across US fall-back (2026-11-01)", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
  });
});

describe("mondayOf", () => {
  it("returns self when the input is Monday", () => {
    expect(mondayOf("2026-10-19")).toBe("2026-10-19");
  });
  it("steps back to Monday for each day of the week", () => {
    expect(mondayOf("2026-10-20")).toBe("2026-10-19"); // Tuesday
    expect(mondayOf("2026-10-21")).toBe("2026-10-19"); // Wednesday
    expect(mondayOf("2026-10-22")).toBe("2026-10-19"); // Thursday
    expect(mondayOf("2026-10-23")).toBe("2026-10-19"); // Friday
    expect(mondayOf("2026-10-24")).toBe("2026-10-19"); // Saturday
    expect(mondayOf("2026-10-25")).toBe("2026-10-19"); // Sunday
  });
  it("handles the first day of a month correctly", () => {
    // 2026-11-01 is a Sunday → Monday is 2026-10-26
    expect(mondayOf("2026-11-01")).toBe("2026-10-26");
  });
});

describe("weekDates", () => {
  it("returns exactly 7 dates", () => {
    expect(weekDates("2026-10-19")).toHaveLength(7);
  });
  it("starts on the given Monday and ends on Sunday", () => {
    const dates = weekDates("2026-10-19");
    expect(dates[0]).toBe("2026-10-19");
    expect(dates[6]).toBe("2026-10-25");
  });
  it("spans a month boundary correctly", () => {
    const dates = weekDates("2026-10-26");
    expect(dates[0]).toBe("2026-10-26");
    expect(dates[6]).toBe("2026-11-01");
  });
});

describe("dayViewLabel", () => {
  it("returns 'Today' when date matches today", () => {
    expect(dayViewLabel("2026-10-20", "2026-10-20")).toBe("Today");
  });
  it("returns 'Tomorrow' for the next day", () => {
    expect(dayViewLabel("2026-10-21", "2026-10-20")).toBe("Tomorrow");
  });
  it("returns a formatted date string otherwise", () => {
    const label = dayViewLabel("2026-10-19", "2026-10-20");
    expect(label).toContain("19");
    expect(label).toContain("October");
    expect(label).toContain("Monday");
  });
});

describe("weekRangeLabel", () => {
  it("uses a single month when Sunday is in the same month", () => {
    expect(weekRangeLabel("2026-10-19")).toBe("Oct 19 to 25");
  });
  it("uses two months when the week spans a month boundary", () => {
    const label = weekRangeLabel("2026-10-26");
    expect(label).toContain("Oct 26");
    expect(label).toContain("Nov");
    expect(label).toContain("to");
  });
});
