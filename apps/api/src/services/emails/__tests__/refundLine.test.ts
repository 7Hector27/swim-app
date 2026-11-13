import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { render as renderReactEmail } from "@react-email/render";

import { renderEmail } from "../render";
import CoachBulkCancel from "../templates/CoachBulkCancel";
import { refundSentence, formatMoneyCents } from "../templates/shared/copyHelpers";
import type { LessonEmailPayload } from "../types";
import type { BulkCancelEmailPayload } from "../bulkCancelTypes";

// A full LessonEmailPayload fixture with the refund fields blank by
// default. Individual tests fill them in to drive the "refund line
// present / absent / zero" branches.
const BASE_LESSON_PAYLOAD: LessonEmailPayload = {
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
  declineReason: null,
  expiresAtLocalDisplay: null,
  expiryHoursBeforeStart: null,
  coachFirstName: "Jason",
  initiatedBy: null,
  refundAmountCents: null,
  newBalanceCents: null,
};

const BASE_BULK_PAYLOAD: BulkCancelEmailPayload = {
  bulkCancellationId: "cccccccc-0000-0000-0000-000000000003",
  householdId: "dddddddd-0000-0000-0000-000000000004",
  startDateLocal: "Nov 5, 2026",
  endDateLocal: "Nov 5, 2026",
  startTimeLocal: null,
  endTimeLocal: null,
  locationName: null,
  message: null,
  coachFirstName: "Jason",
  deepLink: "https://example.test/dashboard",
  cancelledLessons: [
    {
      lessonId: "aaaaaaaa-0000-0000-0000-000000000001",
      startsAtUtc: "2026-11-05T18:00:00.000Z",
      endsAtUtc: "2026-11-05T18:30:00.000Z",
      startsAtLocalDisplay: "Thu, Nov 5, 2026 at 10:00 AM",
      durationMinutes: 30,
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
      calendarSequence: 1,
      wasInvited: true,
    },
  ],
  declinedRequests: [],
  refundAmountCents: null,
  newBalanceCents: null,
};

async function renderBulkCancel(payload: BulkCancelEmailPayload): Promise<string> {
  const element = CoachBulkCancel({
    payload,
    siteUrl: "https://example.test",
    replyToEmail: null,
  });
  return renderReactEmail(element);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-03T18:00:00.000Z"));
  process.env.SITE_URL = "https://example.test";
  process.env.NODE_ENV = "test";
});

afterEach(() => {
  vi.useRealTimers();
});

describe("refundSentence helper", () => {
  it("renders 'Refunded $X. New balance: $Y.' when both amounts are positive", () => {
    expect(refundSentence(6_000, 24_000)).toBe(
      "Refunded $60.00. New balance: $240.00.",
    );
  });

  it("returns null when refundAmountCents is null (free lesson / pre-Phase-4)", () => {
    expect(refundSentence(null, 24_000)).toBeNull();
  });

  it("returns null when newBalanceCents is null (defensive — caller didn't snapshot)", () => {
    expect(refundSentence(6_000, null)).toBeNull();
  });

  it("returns null for a zero refund (already-refunded idempotent no-op)", () => {
    expect(refundSentence(0, 24_000)).toBeNull();
  });
});

describe("formatMoneyCents helper", () => {
  it("formats positive cents with two decimals", () => {
    expect(formatMoneyCents(6_000)).toBe("$60.00");
    expect(formatMoneyCents(600)).toBe("$6.00");
    expect(formatMoneyCents(6)).toBe("$0.06");
  });
  it("groups thousands", () => {
    expect(formatMoneyCents(108_000)).toBe("$1,080.00");
  });
  it("renders the sign for negative values (debug only — body copy uses positive)", () => {
    expect(formatMoneyCents(-6_000)).toBe("-$60.00");
  });
});

describe("Refund line in rendered templates", () => {
  it("lesson_canceled: renders 'Refunded $60.00. New balance: $240.00.' when the refund fields are set", async () => {
    const rendered = await renderEmail("lesson_canceled", {
      ...BASE_LESSON_PAYLOAD,
      refundAmountCents: 6_000,
      newBalanceCents: 24_000,
    });
    expect(rendered.html ?? "").toContain(
      "Refunded $60.00. New balance: $240.00.",
    );
    expect(rendered.text).toContain("Refunded $60.00. New balance: $240.00.");
  });

  it("lesson_canceled: hides the refund line on a free lesson (both fields null)", async () => {
    const rendered = await renderEmail("lesson_canceled", {
      ...BASE_LESSON_PAYLOAD,
      refundAmountCents: null,
      newBalanceCents: null,
    });
    expect(rendered.html ?? "").not.toContain("Refunded");
    expect(rendered.html ?? "").not.toContain("New balance");
  });

  it("request_declined: renders the refund line when the refund landed", async () => {
    const rendered = await renderEmail("request_declined", {
      ...BASE_LESSON_PAYLOAD,
      declineReason: "Coach unavailable",
      refundAmountCents: 9_000,
      newBalanceCents: 15_000,
    });
    expect(rendered.html ?? "").toContain(
      "Refunded $90.00. New balance: $150.00.",
    );
  });

  it("request_declined: no refund line when refundAmountCents is null (pending request that was never charged)", async () => {
    const rendered = await renderEmail("request_declined", {
      ...BASE_LESSON_PAYLOAD,
      declineReason: "Coach unavailable",
      refundAmountCents: null,
      newBalanceCents: null,
    });
    expect(rendered.html ?? "").not.toContain("Refunded");
  });

  it("request_expired: renders the refund line when cron expiry refunded a charged pending", async () => {
    const rendered = await renderEmail("request_expired", {
      ...BASE_LESSON_PAYLOAD,
      expiresAtLocalDisplay: "Wed, Nov 4, 2026 at 6:00 PM",
      expiryHoursBeforeStart: 16,
      refundAmountCents: 6_000,
      newBalanceCents: 18_000,
    });
    expect(rendered.html ?? "").toContain(
      "Refunded $60.00. New balance: $180.00.",
    );
  });

  it("coach_bulk_cancel: renders ONE line per family with their total refund + new balance", async () => {
    const html = await renderBulkCancel({
      ...BASE_BULK_PAYLOAD,
      // Family's slice: three lessons refunded for $180 total; balance now $600.
      refundAmountCents: 18_000,
      newBalanceCents: 60_000,
    });
    expect(html).toContain("Refunded $180.00. New balance: $600.00.");
    // Only one line — the family's own summary, not a per-lesson breakdown.
    const matches = html.match(/Refunded \$180\.00/g);
    expect(matches?.length).toBe(1);
  });

  it("coach_bulk_cancel: hides the refund line when every affected lesson was free (null refund)", async () => {
    const html = await renderBulkCancel({
      ...BASE_BULK_PAYLOAD,
      refundAmountCents: null,
      newBalanceCents: null,
    });
    expect(html).not.toContain("Refunded");
  });

  it("the refund line is purely numeric — no names or location details leak", async () => {
    const rendered = await renderEmail("lesson_canceled", {
      ...BASE_LESSON_PAYLOAD,
      refundAmountCents: 6_000,
      newBalanceCents: 24_000,
    });
    const line = "Refunded $60.00. New balance: $240.00.";
    expect(rendered.text).toContain(line);
    // The sentence itself contains only the amounts + the balance — no
    // swimmer names, no coach names, no location names.
    expect(line).not.toMatch(/Avery|Jason|Egret/);
  });
});
