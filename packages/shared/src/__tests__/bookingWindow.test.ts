import { describe, it, expect } from "vitest";
import {
  bookingWindowEnd,
  isAfterBookingWindow,
  laCalendarDate,
} from "../lib/bookingWindow";

describe("bookingWindowEnd", () => {
  it("returns the Sunday of week 10 when 'now' is a Monday LA morning", () => {
    // 2026-10-26 Mon 09:00 PDT = 2026-10-26T16:00:00Z
    const now = new Date("2026-10-26T16:00:00Z");
    // Week 1 Mon→Sun = 2026-10-26 → 2026-11-01
    // Week 10 Sun = 2026-10-26 + 69 days = 2027-01-03
    expect(bookingWindowEnd(now, 10)).toBe("2027-01-03");
  });

  it("returns the Sunday of week 10 when 'now' is Sunday evening LA (week-boundary edge)", () => {
    // 2026-11-01 Sun 23:30 PDT = 2026-11-02T06:30:00Z (Sun → DST ends 02:00 PST this day)
    // In LA this is still 2026-11-01 (Sunday). Current week Mon 2026-10-26 → Sun 2026-11-01.
    // Week 10 Sun = 2026-10-26 + 69 days = 2027-01-03.
    const now = new Date("2026-11-02T06:30:00Z");
    expect(laCalendarDate(now)).toBe("2026-11-01");
    expect(bookingWindowEnd(now, 10)).toBe("2027-01-03");
  });

  it("handles DST fall-back week without shifting the window end", () => {
    // Thu 2026-10-29 10:00 PDT = 2026-10-29T17:00:00Z (DST not yet ended)
    // Week 1 Mon 2026-10-26 → Sun 2026-11-01 (DST ends 2026-11-01 02:00)
    // Week 10 Sun 2027-01-03. DST-crossing weeks don't skew the end date.
    const now = new Date("2026-10-29T17:00:00Z");
    expect(bookingWindowEnd(now, 10)).toBe("2027-01-03");
  });

  it("handles DST spring-forward week without shifting the window end", () => {
    // Tue 2026-03-03 10:00 PST = 2026-03-03T18:00:00Z. DST starts 2026-03-08.
    // Week 1 Mon 2026-03-02 → Sun 2026-03-08
    // Week 10 Sun = 2026-03-02 + 69 days = 2026-05-10
    const now = new Date("2026-03-03T18:00:00Z");
    expect(bookingWindowEnd(now, 10)).toBe("2026-05-10");
  });

  it("week 1 ends today when today is a Sunday", () => {
    // Sun 2026-10-25 15:00 PDT = 2026-10-25T22:00:00Z
    const now = new Date("2026-10-25T22:00:00Z");
    expect(bookingWindowEnd(now, 1)).toBe("2026-10-25");
  });

  it("maxWeeks = 1 returns the current week's Sunday", () => {
    // Wed 2026-10-28 10:00 PDT. Current week Sun = 2026-11-01.
    const now = new Date("2026-10-28T17:00:00Z");
    expect(bookingWindowEnd(now, 1)).toBe("2026-11-01");
  });
});

describe("isAfterBookingWindow", () => {
  it("accepts a slot on the final Sunday", () => {
    const now = new Date("2026-10-26T16:00:00Z"); // Mon
    // Any instant whose LA date is 2027-01-03 (window end).
    const slot = new Date("2027-01-03T22:00:00Z"); // 2 PM PST
    expect(laCalendarDate(slot)).toBe("2027-01-03");
    expect(isAfterBookingWindow(slot, now, 10)).toBe(false);
  });

  it("rejects a slot one day past the window", () => {
    const now = new Date("2026-10-26T16:00:00Z"); // Mon
    // 2027-01-04 Mon anywhere → one day past window end.
    const slot = new Date("2027-01-04T22:00:00Z");
    expect(laCalendarDate(slot)).toBe("2027-01-04");
    expect(isAfterBookingWindow(slot, now, 10)).toBe(true);
  });
});
