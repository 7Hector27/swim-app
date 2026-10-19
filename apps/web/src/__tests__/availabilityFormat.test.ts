import { describe, it, expect } from "vitest";
import {
  isValidDateIso,
  formatMonthDay,
  formatMonthDayYear,
  weekdayShort,
  addDaysIso,
} from "../content/CoachAvailabilityContent/availabilityFormat";

describe("isValidDateIso", () => {
  it("accepts a valid date", () => {
    expect(isValidDateIso("2026-10-15")).toBe(true);
  });
  it("rejects empty string", () => {
    expect(isValidDateIso("")).toBe(false);
  });
  it("rejects partial date", () => {
    expect(isValidDateIso("2026-12")).toBe(false);
  });
  it("rejects non-date string", () => {
    expect(isValidDateIso("not-a-date")).toBe(false);
  });
  it("rejects date with letters", () => {
    expect(isValidDateIso("2026-1x-15")).toBe(false);
  });
});

describe("formatMonthDay", () => {
  it("formats a valid date", () => {
    expect(formatMonthDay("2026-10-15")).toBe("Oct 15");
  });
  it("returns empty string for empty input", () => {
    expect(formatMonthDay("")).toBe("");
  });
  it("returns empty string for partial date", () => {
    expect(formatMonthDay("2026-12")).toBe("");
  });
  it("returns empty string for invalid string", () => {
    expect(formatMonthDay("not-a-date")).toBe("");
  });
});

describe("formatMonthDayYear", () => {
  it("formats a valid date", () => {
    expect(formatMonthDayYear("2026-10-15")).toBe("Oct 15, 2026");
  });
  it("returns empty string for empty input", () => {
    expect(formatMonthDayYear("")).toBe("");
  });
  it("returns empty string for partial date", () => {
    expect(formatMonthDayYear("2026-12")).toBe("");
  });
});

describe("weekdayShort", () => {
  it("returns a weekday label for a valid date", () => {
    expect(weekdayShort("2026-10-15")).toBe("Thu");
  });
  it("returns empty string for empty input", () => {
    expect(weekdayShort("")).toBe("");
  });
  it("returns empty string for invalid input", () => {
    expect(weekdayShort("bad")).toBe("");
  });
});

describe("addDaysIso", () => {
  it("adds days correctly", () => {
    expect(addDaysIso("2026-10-15", 1)).toBe("2026-10-16");
    expect(addDaysIso("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDaysIso("2026-10-15", -1)).toBe("2026-10-14");
  });
  it("returns empty string for empty input", () => {
    expect(addDaysIso("", 1)).toBe("");
  });
  it("returns empty string for invalid input", () => {
    expect(addDaysIso("not-a-date", 1)).toBe("");
  });
});
