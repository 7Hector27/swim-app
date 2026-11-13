import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderEmail } from "../services/emails/render";
import type { LessonEmailPayload } from "../services/emails/types";

// Clock is pinned so timestamps emitted by any renderer internals stay
// stable across machines. The payload itself carries pre-formatted display
// strings, so these tests are deterministic regardless, but the pin keeps
// them aligned with the rest of the suite's time-sensitive fixtures.
const NOW = new Date("2026-11-03T18:00:00.000Z");

const BASE_PAYLOAD: LessonEmailPayload = {
  lessonId: "aaaaaaaa-0000-0000-0000-000000000001",
  startsAtUtc: "2026-11-05T18:00:00.000Z",
  endsAtUtc: "2026-11-05T18:30:00.000Z",
  durationMinutes: 30,
  startsAtLocalDisplay: "Thu, Nov 5, 2026 at 10:00 AM",
  endsAtLocalDisplay: "Thu, Nov 5, 2026 at 10:30 AM",
  swimmerFirstNames: ["Avery"],
  location: {
    id: "bbbbbbbb-0000-0000-0000-000000000002",
    name: "Egret Park",
    address: "123 Pool Ln",
    city: "Irvine",
    state: "CA",
    zip: "92620",
    isHomePool: false,
  },
  deepLink: "https://example.test/dashboard/lessons/aaaaaaaa-0000-0000-0000-000000000001",
  actorRole: "parent",
  previousStartsAtUtc: null,
  previousStartsAtLocalDisplay: null,
  coachFirstName: "Jason",
  declineReason: null,
  expiresAtLocalDisplay: "Thu, Nov 5, 2026 at 2:00 AM",
  expiryHoursBeforeStart: null,
  initiatedBy: null,
  refundAmountCents: null,
  newBalanceCents: null,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  // Minimal env so render.ts's getEnv() doesn't crash. Only siteUrl is read.
  process.env.SITE_URL = "https://example.test";
  process.env.NODE_ENV = "test";
});

afterEach(() => {
  vi.useRealTimers();
});

describe("email templates — expiryHoursBeforeStart = null", () => {
  it("BookingRequested omits the hour count entirely instead of printing a stale 16", async () => {
    // Was: template did `payload.expiryHoursBeforeStart ?? 16`, which meant
    // a null payload value silently printed "approval can take up to 16
    // hours" — a number the user never configured and that was wrong the
    // moment the coach moved bookingMinAdvanceHours off the default.
    const rendered = await renderEmail("booking_requested", {
      ...BASE_PAYLOAD,
      expiryHoursBeforeStart: null,
    });
    expect(rendered.text).not.toMatch(/\b16\s*hours?\b/i);
    expect(rendered.text).not.toMatch(/approval can take up to/i);
    expect(rendered.text).toMatch(/We got your request/i);
  });

  it("RequestExpired drops the window phrase but still explains what happened", async () => {
    const rendered = await renderEmail("request_expired", {
      ...BASE_PAYLOAD,
      expiryHoursBeforeStart: null,
    });
    expect(rendered.text).not.toMatch(/\b16\s*hours?\b/i);
    expect(rendered.text).toMatch(/This request expired/i);
    expect(rendered.text).toMatch(/before the lesson/i);
  });

  it("BookingRequested with a real hour value keeps the sentence intact", async () => {
    const rendered = await renderEmail("booking_requested", {
      ...BASE_PAYLOAD,
      expiryHoursBeforeStart: 24,
    });
    expect(rendered.text).toMatch(/up to 24 hours/);
  });

  it("RequestExpired with a real hour value keeps the sentence intact", async () => {
    const rendered = await renderEmail("request_expired", {
      ...BASE_PAYLOAD,
      expiryHoursBeforeStart: 24,
    });
    expect(rendered.text).toMatch(/expire 24 hours before/);
  });

  it("RequestExpired uses the singular for 1 hour", async () => {
    const rendered = await renderEmail("request_expired", {
      ...BASE_PAYLOAD,
      expiryHoursBeforeStart: 1,
    });
    expect(rendered.text).toMatch(/expire 1 hour before/);
  });
});
