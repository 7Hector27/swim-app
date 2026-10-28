import { describe, expect, it } from "vitest";

import {
  isInsideQuietHours,
  laDateString,
  laTimeIsAtOrPast,
  nextLaWallTimeAfter,
  parseWallTimeMinutes,
} from "../quietHours";

describe("parseWallTimeMinutes", () => {
  it("parses HH:MM", () => {
    expect(parseWallTimeMinutes("07:00")).toBe(7 * 60);
    expect(parseWallTimeMinutes("21:30")).toBe(21 * 60 + 30);
  });

  it("accepts HH:MM:SS by ignoring seconds", () => {
    expect(parseWallTimeMinutes("08:00:00")).toBe(8 * 60);
  });
});

describe("isInsideQuietHours", () => {
  // 2026-10-27 02:00 America/Los_Angeles (PDT UTC-7) is 09:00 UTC.
  const twoAmLa = new Date("2026-10-27T09:00:00Z");
  // 10:00 LA = 17:00 UTC.
  const tenAmLa = new Date("2026-10-27T17:00:00Z");
  // 22:00 LA = 2026-10-28T05:00:00Z.
  const tenPmLa = new Date("2026-10-28T05:00:00Z");

  it("wrap-around (21:00–07:00) covers 2 AM", () => {
    expect(isInsideQuietHours(twoAmLa, "21:00", "07:00", true)).toBe(true);
  });

  it("wrap-around (21:00–07:00) covers 10 PM", () => {
    expect(isInsideQuietHours(tenPmLa, "21:00", "07:00", true)).toBe(true);
  });

  it("wrap-around (21:00–07:00) does not cover 10 AM", () => {
    expect(isInsideQuietHours(tenAmLa, "21:00", "07:00", true)).toBe(false);
  });

  it("non-wrap (10:00–14:00) covers 10 AM", () => {
    expect(isInsideQuietHours(tenAmLa, "10:00", "14:00", true)).toBe(true);
  });

  it("non-wrap (10:00–14:00) does not cover 2 AM", () => {
    expect(isInsideQuietHours(twoAmLa, "10:00", "14:00", true)).toBe(false);
  });

  it("returns false when disabled", () => {
    expect(isInsideQuietHours(twoAmLa, "21:00", "07:00", false)).toBe(false);
  });
});

describe("nextLaWallTimeAfter", () => {
  it("returns today's end-of-quiet-hours when it's still ahead", () => {
    // 2 AM LA — the next 07:00 LA is in ~5 hours.
    const twoAmLa = new Date("2026-10-27T09:00:00Z");
    const next = nextLaWallTimeAfter(twoAmLa, "07:00");
    expect(next.toISOString()).toBe("2026-10-27T14:00:00.000Z"); // 7 AM LA = 14 UTC (PDT)
  });

  it("rolls to tomorrow when end-of-quiet-hours already passed today", () => {
    // 10 AM LA, next 07:00 LA is tomorrow 07:00.
    const tenAmLa = new Date("2026-10-27T17:00:00Z");
    const next = nextLaWallTimeAfter(tenAmLa, "07:00");
    expect(next.toISOString()).toBe("2026-10-28T14:00:00.000Z");
  });
});

describe("laDateString", () => {
  it("returns YYYY-MM-DD in LA", () => {
    // 2 AM LA on Oct 27 is 09:00 UTC same day.
    expect(laDateString(new Date("2026-10-27T09:00:00Z"))).toBe("2026-10-27");
    // 11 PM LA on Oct 26 is 06:00 UTC Oct 27 — but we're one hour before
    // midnight LA, so the LA date is still Oct 26.
    expect(laDateString(new Date("2026-10-27T06:00:00Z"))).toBe("2026-10-26");
  });
});

describe("laTimeIsAtOrPast", () => {
  it("returns true when now is after the target", () => {
    const tenAmLa = new Date("2026-10-27T17:00:00Z");
    expect(laTimeIsAtOrPast(tenAmLa, "08:00")).toBe(true);
  });

  it("returns false when now is before the target", () => {
    const sixAmLa = new Date("2026-10-27T13:00:00Z");
    expect(laTimeIsAtOrPast(sixAmLa, "08:00")).toBe(false);
  });

  it("returns true at the exact target minute", () => {
    const eightAmLa = new Date("2026-10-27T15:00:00Z");
    expect(laTimeIsAtOrPast(eightAmLa, "08:00")).toBe(true);
  });
});
