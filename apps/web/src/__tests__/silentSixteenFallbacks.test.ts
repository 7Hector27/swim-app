import { describe, expect, it } from "vitest";

import { apiErrorMessage } from "@/lib/apiErrorMessage";
import {
  pickReasonCopy,
} from "@/content/BookCalendarContent/batchHelpers";
import { tooSoonMessage } from "@/content/BookCalendarContent/helpers";

// Regression lock for the "silent 16" fallbacks. Each of these helpers
// used to default a missing bookingMinAdvanceHours to the old hardcoded
// 16 and quietly print that number to the parent. The field is now
// coach-editable (availability_config.bookingMinAdvanceHours), so any
// hardcoded 16 is wrong the moment the coach changes the setting.

describe("too_soon copy — no bookingMinAdvanceHours echoed", () => {
  it("apiErrorMessage omits the hour count instead of printing 16", () => {
    const message = apiErrorMessage("too_soon");
    expect(message).not.toMatch(/\b16\b/);
    expect(message).not.toMatch(/\bhours?\b/);
    expect(message).toMatch(/text jason/i);
  });

  it("pickReasonCopy omits the hour count when hours is null", () => {
    const copy = pickReasonCopy("too_soon", null);
    expect(copy).not.toMatch(/\b16\b/);
    expect(copy).not.toMatch(/\bhours?\b/);
    expect(copy.length).toBeGreaterThan(0);
  });

  it("tooSoonMessage omits the hour count when hours is null", () => {
    const message = tooSoonMessage(null);
    expect(message).not.toMatch(/\b16\b/);
    expect(message).not.toMatch(/\bhours?\b/);
    expect(message).toMatch(/text jason/i);
  });
});

describe("too_soon copy — bookingMinAdvanceHours is echoed", () => {
  it("apiErrorMessage uses the echoed value (not a baked-in 16)", () => {
    expect(apiErrorMessage("too_soon", undefined, 24)).toMatch(/24 hours/);
    expect(apiErrorMessage("too_soon", undefined, 1)).toMatch(/1 hour\b/);
    // The coach could have the setting at 8 — the old ?? 16 would have
    // printed 16 here, which is what the lock is guarding against.
    expect(apiErrorMessage("too_soon", undefined, 8)).toMatch(/8 hours/);
    expect(apiErrorMessage("too_soon", undefined, 8)).not.toMatch(/16/);
  });

  it("pickReasonCopy uses the passed value (not a baked-in 16)", () => {
    expect(pickReasonCopy("too_soon", 24)).toBe("Less than 24 hours away");
    expect(pickReasonCopy("too_soon", 1)).toBe("Less than 1 hour away");
    expect(pickReasonCopy("too_soon", 8)).toBe("Less than 8 hours away");
  });

  it("tooSoonMessage uses the passed value and pluralizes hour", () => {
    expect(tooSoonMessage(24)).toMatch(/less than 24 hours/);
    expect(tooSoonMessage(1)).toMatch(/less than 1 hour\b/);
    expect(tooSoonMessage(8)).not.toMatch(/16/);
  });
});
