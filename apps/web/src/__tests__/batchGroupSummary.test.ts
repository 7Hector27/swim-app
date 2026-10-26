// Covers the pure summary builder that the grouped batch card renders in the
// coach pending list (ADR 030 phase 3). Two scenarios exercise the two shapes
// the summary must handle without printing blank separators:
//
//   1. Weekly batch with two weekdays at different times — pattern lists both
//      "Tue 4:30 PM, Thu 5:00 PM" rather than only the first lesson's day.
//   2. Mixed-length multi-booking — length collapses to "mixed lengths" and
//      the summary never prints a trailing "," or empty "·" segment.

import { describe, it, expect } from "vitest";
import { buildBatchGroupSummary } from "../content/CoachDashboardContent/batchGroupSummary";

// Helper to make readable UTC starts from an LA wall-clock time. Oct 27 2026
// is PDT (UTC-7) → LA 4:30 PM is 23:30 UTC. Nov 10 2026 is PST (UTC-8), so
// LA 5:00 PM is 01:00 UTC the next day; we stay inside PDT for the main
// cases so weekdays stay stable.
function laPdtUtcIso(dateYmd: string, hhmm: string): string {
  const [year, month, day] = dateYmd.split("-").map(Number);
  const [hour, minute] = hhmm.split(":").map(Number);
  // PDT is UTC-7, so add 7 hours to the LA wall-clock to get UTC.
  const utc = new Date(Date.UTC(year!, month! - 1, day!, hour! + 7, minute!));
  return utc.toISOString();
}

describe("buildBatchGroupSummary", () => {
  it("weekly batch with two weekdays lists both days and times, one length, and the date range", () => {
    // Tue 2026-10-27 and Thu 2026-10-29 for 3 weeks → 6 lessons.
    const lessons = [
      // Week 1
      { startsAt: laPdtUtcIso("2026-10-27", "16:30"), durationMinutes: 30 as const },
      { startsAt: laPdtUtcIso("2026-10-29", "17:00"), durationMinutes: 30 as const },
      // Week 2
      { startsAt: laPdtUtcIso("2026-11-03", "16:30"), durationMinutes: 30 as const },
      { startsAt: laPdtUtcIso("2026-11-05", "17:00"), durationMinutes: 30 as const },
      // Week 3
      { startsAt: laPdtUtcIso("2026-11-10", "16:30"), durationMinutes: 30 as const },
      { startsAt: laPdtUtcIso("2026-11-12", "17:00"), durationMinutes: 30 as const },
    ];

    const summary = buildBatchGroupSummary({ lessons, mode: "weekly" });

    expect(summary).toContain("6 weekly lessons");
    expect(summary).toContain("Tue 4:30 PM");
    expect(summary).toContain("Thu 5:00 PM");
    // Both weekday+time entries appear exactly once each.
    expect(summary.match(/Tue 4:30 PM/g)).toHaveLength(1);
    expect(summary.match(/Thu 5:00 PM/g)).toHaveLength(1);
    expect(summary).toContain("30 min");
    // Date range runs from the first lesson's LA date to the last.
    expect(summary).toContain("Oct 27 to Nov 12");

    // No doubled commas, no leading/trailing separators, no stray middle dots.
    expect(summary).not.toMatch(/,\s*,/);
    expect(summary).not.toMatch(/\s·\s*,/);
    expect(summary).not.toMatch(/,\s*·/);
    expect(summary.trim()).toBe(summary);
    expect(summary.endsWith(",")).toBe(false);
  });

  it("mixed-length multi-booking renders 'mixed lengths' and never prints empty separators", () => {
    // Three picks on three different days with three different lengths. All
    // three dates sit in PDT (US DST ends 2026-11-01) so the helper's wall-
    // clock → UTC conversion is correct.
    const lessons = [
      { startsAt: laPdtUtcIso("2026-10-27", "16:00"), durationMinutes: 30 as const },
      { startsAt: laPdtUtcIso("2026-10-29", "17:00"), durationMinutes: 45 as const },
      { startsAt: laPdtUtcIso("2026-10-31", "18:00"), durationMinutes: 60 as const },
    ];

    const summary = buildBatchGroupSummary({ lessons, mode: "manual" });

    // Manual mode: no "weekly " in the count label.
    expect(summary).toContain("3 lessons");
    expect(summary).not.toContain("weekly lesson");
    // Mixed lengths collapse to the single label.
    expect(summary).toContain("mixed lengths");
    expect(summary).not.toContain("30 min");
    expect(summary).not.toContain("45 min");
    expect(summary).not.toContain("60 min");
    // Date range from first to last pick.
    expect(summary).toContain("Oct 27 to Oct 31");

    // Pattern entries fit under the cap, so each day/time pair should still appear.
    expect(summary).toContain("Tue 4:00 PM");
    expect(summary).toContain("Thu 5:00 PM");
    expect(summary).toContain("Sat 6:00 PM");

    // No doubled commas / blank separators / dangling punctuation.
    expect(summary).not.toMatch(/,\s*,/);
    expect(summary).not.toMatch(/\s·\s*,/);
    expect(summary).not.toMatch(/,\s*·/);
    expect(summary).not.toMatch(/·\s*·/);
    expect(summary.endsWith(",")).toBe(false);
    expect(summary.endsWith("·")).toBe(false);
  });

  it("a batch where every lesson falls on the same LA date shows the date once, not 'to'", () => {
    const lessons = [
      { startsAt: laPdtUtcIso("2026-10-27", "16:00"), durationMinutes: 30 as const },
      { startsAt: laPdtUtcIso("2026-10-27", "17:00"), durationMinutes: 30 as const },
    ];
    const summary = buildBatchGroupSummary({ lessons, mode: "manual" });
    expect(summary).toContain("Oct 27");
    expect(summary).not.toContain("Oct 27 to Oct 27");
  });
});
