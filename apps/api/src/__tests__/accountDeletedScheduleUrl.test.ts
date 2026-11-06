// Pure-function tests for the coach-schedule link used by both the
// account_deleted notification (bell + push) and the account_deleted
// email. The link must never reference a lesson, batch, or household
// from the deleted family — those are either gone or anonymized by the
// time this URL fires (ADR 034).

import { describe, it, expect } from "vitest";

import { buildAccountDeletedScheduleUrl } from "../services/accountDeletion";

describe("buildAccountDeletedScheduleUrl", () => {
  const siteUrl = "https://example.test";

  it("day view keyed on the first freed lesson's LA calendar date (PST)", () => {
    // 2026-01-15T18:30:00Z → LA 10:30 AM on 2026-01-15 (PST, UTC-8).
    const firstFreed = new Date("2026-01-15T18:30:00Z");
    expect(buildAccountDeletedScheduleUrl(siteUrl, firstFreed)).toBe(
      "https://example.test/coach/schedule?view=day&date=2026-01-15",
    );
  });

  it("day view keyed on the LA calendar date for a late-evening UTC instant that crosses midnight (PST)", () => {
    // 2026-01-16T06:30:00Z → LA 10:30 PM on 2026-01-15 (PST, UTC-8).
    const lateEveningLaUtc = new Date("2026-01-16T06:30:00Z");
    expect(buildAccountDeletedScheduleUrl(siteUrl, lateEveningLaUtc)).toBe(
      "https://example.test/coach/schedule?view=day&date=2026-01-15",
    );
  });

  it("day view keyed on the LA calendar date during PDT", () => {
    // 2026-07-15T18:30:00Z → LA 11:30 AM on 2026-07-15 (PDT, UTC-7).
    const summer = new Date("2026-07-15T18:30:00Z");
    expect(buildAccountDeletedScheduleUrl(siteUrl, summer)).toBe(
      "https://example.test/coach/schedule?view=day&date=2026-07-15",
    );
  });

  it("today view when no lessons were freed", () => {
    expect(buildAccountDeletedScheduleUrl(siteUrl, null)).toBe(
      "https://example.test/coach/schedule",
    );
  });

  it("strips trailing slashes from siteUrl", () => {
    expect(
      buildAccountDeletedScheduleUrl("https://example.test/", null),
    ).toBe("https://example.test/coach/schedule");
    expect(
      buildAccountDeletedScheduleUrl(
        "https://example.test///",
        new Date("2026-01-15T18:30:00Z"),
      ),
    ).toBe("https://example.test/coach/schedule?view=day&date=2026-01-15");
  });
});
