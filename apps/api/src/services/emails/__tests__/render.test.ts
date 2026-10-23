// Phase 2 renderer tests. One snapshot-style assertion per template:
// subject, deep link, lesson details, plain-text alt, no em dashes, no
// stale calendar.google.com link. The lifecycle test (approve → reschedule
// → cancel) lives in the integration suite — it needs a real DB.

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
  coachFirstName: "Jason",
};

const ALL_EVENTS: LessonEmailEvent[] = [
  "booking_requested",
  "lesson_confirmed",
  "request_declined",
  "request_expired",
  "lesson_canceled",
  "lesson_rescheduled",
];

describe("renderEmail — subjects", () => {
  const cases: Array<[LessonEmailEvent, string]> = [
    ["booking_requested", "Request received: Sat, Nov 1, 2026 at 10:30 AM"],
    ["lesson_confirmed", "Lesson confirmed: Sat, Nov 1, 2026 at 10:30 AM"],
    ["request_declined", "Request not booked: Sat, Nov 1, 2026 at 10:30 AM"],
    ["request_expired", "Request expired: Sat, Nov 1, 2026 at 10:30 AM"],
    ["lesson_canceled", "Lesson canceled: Sat, Nov 1, 2026 at 10:30 AM"],
    ["lesson_rescheduled", "Lesson rescheduled: Sat, Nov 1, 2026 at 10:30 AM"],
  ];

  it.each(cases)("event %s uses the plan's colon-prefixed subject", async (event, expected) => {
    const { subject } = await renderEmail(event, basePayload);
    expect(subject).toBe(expected);
  });
});

describe("renderEmail — every template", () => {
  it.each(ALL_EVENTS)(
    "%s: subject, deep link, lesson time, plain text, no em dash, no calendar.google.com",
    async (event) => {
      const { subject, text, html } = await renderEmail(event, {
        ...basePayload,
        // Give the reschedule template a previousStartsAt so the branch
        // renders.
        previousStartsAtLocalDisplay:
          event === "lesson_rescheduled" ? "Sat, Oct 25, 2026 at 10:30 AM" : null,
      });

      // Subject never has an em dash.
      expect(subject).not.toContain("\u2014");

      // Lesson details present in both HTML and plain-text.
      expect(html ?? "").toContain(basePayload.deepLink);
      expect(html ?? "").toContain("Northwood Pool");
      expect(html ?? "").toContain("Sat, Nov 1, 2026 at 10:30 AM");

      expect(text.length).toBeGreaterThan(0);
      expect(text).toContain(basePayload.deepLink);
      expect(text).toContain("Sat, Nov 1, 2026 at 10:30 AM");

      // No em dash in any output.
      expect(html ?? "").not.toContain("\u2014");
      expect(text).not.toContain("\u2014");

      // Guard against the removed "Add to Google Calendar" link.
      expect(html ?? "").not.toContain("calendar.google.com");
      expect(text).not.toContain("calendar.google.com");
    },
  );

  it("lesson_rescheduled template includes both the previous and new times", async () => {
    const { html, text } = await renderEmail("lesson_rescheduled", {
      ...basePayload,
      previousStartsAtLocalDisplay: "Sat, Oct 25, 2026 at 10:30 AM",
    });
    expect(html ?? "").toContain("Sat, Oct 25, 2026 at 10:30 AM");
    expect(html ?? "").toContain("Sat, Nov 1, 2026 at 10:30 AM");
    expect(text).toContain("Sat, Oct 25, 2026 at 10:30 AM");
    expect(text).toContain("Sat, Nov 1, 2026 at 10:30 AM");
  });

  it("request_declined includes the decline reason when present", async () => {
    const { html, text } = await renderEmail("request_declined", {
      ...basePayload,
      declineReason: "Conflict with another lesson",
    });
    expect(html ?? "").toContain("Conflict with another lesson");
    expect(text).toContain("Conflict with another lesson");
  });

  it("lesson_canceled uses the coach's name when the coach initiated", async () => {
    const { html, text } = await renderEmail("lesson_canceled", {
      ...basePayload,
      actorRole: "coach",
    });
    expect(html ?? "").toContain("Jason canceled this lesson");
    expect(text).toContain("Jason canceled this lesson");
  });

  it("lesson_canceled attributes to a household member when a parent initiated", async () => {
    const { html, text } = await renderEmail("lesson_canceled", {
      ...basePayload,
      actorRole: "parent",
    });
    expect(html ?? "").toContain("A household member canceled this lesson");
    expect(text).toContain("A household member canceled this lesson");
  });

  it("booking_requested includes the expiration hint when provided", async () => {
    const { html, text } = await renderEmail("booking_requested", {
      ...basePayload,
      expiresAtLocalDisplay: "Fri, Oct 31, 2026 at 6:30 PM",
    });
    expect(html ?? "").toContain("Fri, Oct 31, 2026 at 6:30 PM");
    expect(text).toContain("Fri, Oct 31, 2026 at 6:30 PM");
  });

  it("falls back to 'The coach' when coachFirstName is null", async () => {
    const { html, text } = await renderEmail("lesson_canceled", {
      ...basePayload,
      coachFirstName: null,
      actorRole: "coach",
    });
    expect(html ?? "").toContain("The coach canceled this lesson");
    expect(text).toContain("The coach canceled this lesson");
  });
});
