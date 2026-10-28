import { describe, expect, it } from "vitest";

import { computeUrgency, shouldBypassQuietHours } from "../urgency";

// A fixed "now" so test assertions don't drift at midnight PT. 2026-10-27
// 10:00:00 America/Los_Angeles. In October LA is on PDT (UTC-7), so
// 10:00 LA = 17:00 UTC.
const NOW = new Date("2026-10-27T17:00:00Z");

describe("computeUrgency", () => {
  it("urgent for a lesson later today", () => {
    const startsAt = new Date("2026-10-27T22:00:00Z"); // 3 PM LA today
    expect(computeUrgency(startsAt, NOW)).toBe("urgent");
  });

  it("urgent for a lesson tomorrow", () => {
    const startsAt = new Date("2026-10-28T18:00:00Z"); // 11 AM LA tomorrow
    expect(computeUrgency(startsAt, NOW)).toBe("urgent");
  });

  it("standard for a lesson day after tomorrow", () => {
    const startsAt = new Date("2026-10-29T18:00:00Z"); // 11 AM LA Thursday
    expect(computeUrgency(startsAt, NOW)).toBe("standard");
  });

  it("standard for a lesson many weeks out", () => {
    const startsAt = new Date("2026-11-20T18:00:00Z");
    expect(computeUrgency(startsAt, NOW)).toBe("standard");
  });
});

describe("shouldBypassQuietHours", () => {
  it("bypasses when starts_at is within 12 hours", () => {
    const startsAt = new Date(NOW.getTime() + 6 * 60 * 60 * 1000);
    expect(shouldBypassQuietHours(startsAt, "standard", NOW)).toBe(true);
  });

  it("does NOT bypass for a lesson 15 hours out even if marked urgent", () => {
    const startsAt = new Date(NOW.getTime() + 15 * 60 * 60 * 1000);
    expect(shouldBypassQuietHours(startsAt, "urgent", NOW)).toBe(false);
  });

  it("does not bypass when startsAt is 24h out", () => {
    const startsAt = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
    expect(shouldBypassQuietHours(startsAt, "standard", NOW)).toBe(false);
  });

  it("no-lesson rows: urgent bypasses, standard holds", () => {
    expect(shouldBypassQuietHours(null, "urgent", NOW)).toBe(true);
    expect(shouldBypassQuietHours(null, "standard", NOW)).toBe(false);
  });
});
