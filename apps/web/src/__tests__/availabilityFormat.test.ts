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
  it("rejects an impossible date like 2026-02-31", () => {
    expect(isValidDateIso("2026-02-31")).toBe(false);
  });
  it("rejects month 13", () => {
    expect(isValidDateIso("2026-13-01")).toBe(false);
  });
  it("accepts Feb 29 on a leap year", () => {
    expect(isValidDateIso("2024-02-29")).toBe(true);
  });
  it("rejects Feb 29 on a non-leap year", () => {
    expect(isValidDateIso("2025-02-29")).toBe(false);
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
