// Phase 1 renderer tests. The temporary plain-text output has to carry the
// minimum useful information (swimmers, date/time, location, deep link) so
// the end-to-end Mailpit test is readable. Phase 2 adds React Email + .ics
// and expands this file.

import { describe, expect, it } from "vitest";
import { renderEmail } from "../render";
import type { LessonEmailEvent, LessonEmailPayload } from "../types";

const basePayload: LessonEmailPayload = {
  lessonId: "11111111-2222-3333-4444-555555555555",
  startsAtUtc: "2026-11-01T17:30:00.000Z",
  endsAtUtc: "2026-11-01T18:00:00.000Z",
  durationMinutes: 30,
  startsAtLocalDisplay: "Sat, Nov 1, 2026 at 10:30 AM",
  endsAtLocalDisplay: "Sat, Nov 1, 2026 at 11:00 AM",
  swimmerFirstNames: ["Alex"],
  location: {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    name: "Northwood Pool",
    address: "123 Example St",
    city: "Irvine",
    state: "CA",
    zip: "92602",
    isHomePool: false,
  },
  deepLink: "https://app.example.com/dashboard/lessons/11111111-2222-3333-4444-555555555555",
  actorRole: "parent",
  previousStartsAtUtc: null,
  previousStartsAtLocalDisplay: null,
  declineReason: null,
  expiresAtLocalDisplay: null,
};

describe("renderEmail — subjects", () => {
  const cases: Array<[LessonEmailEvent, string]> = [
    ["booking_requested", "Request received: Sat, Nov 1, 2026 at 10:30 AM"],
    ["lesson_confirmed", "Lesson confirmed: Sat, Nov 1, 2026 at 10:30 AM"],
    ["request_declined", "Request not booked: Sat, Nov 1, 2026 at 10:30 AM"],
    ["request_expired", "Request expired: Sat, Nov 1, 2026 at 10:30 AM"],
    ["lesson_canceled", "Lesson canceled: Sat, Nov 1, 2026 at 10:30 AM"],
    ["lesson_rescheduled", "Lesson rescheduled: Sat, Nov 1, 2026 at 10:30 AM"],
  ];

  it.each(cases)("event %s uses the plan's colon-prefixed subject", (event, expected) => {
    const { subject } = renderEmail(event, basePayload);
    expect(subject).toBe(expected);
  });

  it("every subject uses a colon separator, never an em dash", () => {
    for (const [event] of cases) {
      const { subject } = renderEmail(event, basePayload);
      expect(subject).not.toContain("—");
    }
  });
});

describe("renderEmail — body", () => {
  it("includes swimmer first name(s), date/time, location name, and the deep link", () => {
    const { text } = renderEmail("lesson_confirmed", basePayload);
    expect(text).toContain("Alex");
    expect(text).toContain("Sat, Nov 1, 2026 at 10:30 AM");
    expect(text).toContain("Northwood Pool");
    expect(text).toContain(basePayload.deepLink);
  });

  it("formats a two-swimmer family lesson with 'and'", () => {
    const { text } = renderEmail("lesson_confirmed", {
      ...basePayload,
      swimmerFirstNames: ["Alex", "Mia"],
    });
    expect(text).toContain("Alex and Mia");
  });

  it("renders the Was: / Now: block on reschedule", () => {
    const { text } = renderEmail("lesson_rescheduled", {
      ...basePayload,
      previousStartsAtUtc: "2026-10-25T17:30:00.000Z",
      previousStartsAtLocalDisplay: "Sat, Oct 25, 2026 at 10:30 AM",
    });
    expect(text).toContain("Was: Sat, Oct 25, 2026 at 10:30 AM");
    expect(text).toContain("Now: Sat, Nov 1, 2026 at 10:30 AM");
  });

  it("includes the decline reason when present", () => {
    const { text } = renderEmail("request_declined", {
      ...basePayload,
      declineReason: "Conflict with another lesson",
    });
    expect(text).toContain("Conflict with another lesson");
  });

  it("includes the expiration hint on booking_requested when set", () => {
    const { text } = renderEmail("booking_requested", {
      ...basePayload,
      expiresAtLocalDisplay: "Fri, Oct 31, 2026 at 6:30 PM",
    });
    expect(text).toContain("Fri, Oct 31, 2026 at 6:30 PM");
  });

  it("renders coach-initiated vs parent-initiated cancel copy differently", () => {
    const coach = renderEmail("lesson_canceled", { ...basePayload, actorRole: "coach" }).text;
    const parent = renderEmail("lesson_canceled", { ...basePayload, actorRole: "parent" }).text;
    expect(coach).toContain("Jason canceled this lesson");
    expect(parent).toContain("A household member canceled this lesson");
  });

  it("uses no em dash in the body copy", () => {
    for (const event of [
      "booking_requested",
      "lesson_confirmed",
      "request_declined",
      "request_expired",
      "lesson_canceled",
      "lesson_rescheduled",
    ] as const) {
      const { text } = renderEmail(event, basePayload);
      expect(text).not.toContain("—");
    }
  });
});
