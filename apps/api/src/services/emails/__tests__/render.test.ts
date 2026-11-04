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
  expiryHoursBeforeStart: null,
  coachFirstName: "Jason",
  initiatedBy: null,
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

describe("renderEmail — coach_booking_request (ADR 031 email backup)", () => {
  const coachPayload = {
    kind: "booking_request_lesson" as const,
    listTitle: "New booking request",
    lessonId: "77777777-8888-9999-aaaa-bbbbbbbbbbbb",
    swimmerFirstNamesWithInitial: ["Alex R."],
    swimmerFullNames: ["Alex Rodriguez"],
    startsAtLocalDisplay: "Tue, Oct 27, 2026 at 4:30 PM",
    locationName: "Egret Park",
  };

  it("uses the plan's colon-prefixed subject", async () => {
    const { subject } = await renderEmail("coach_booking_request", coachPayload);
    expect(subject).toBe("New booking request: Tue, Oct 27, 2026 at 4:30 PM");
  });

  it("renders the lock-screen-safe swimmer initial, not full last name", async () => {
    const { html, text } = await renderEmail("coach_booking_request", coachPayload);
    expect(html).toContain("Alex R.");
    expect(html).not.toContain("Rodriguez");
    expect(text).toContain("Alex R.");
    expect(text).not.toContain("Rodriguez");
  });

  it("renders the deep link to the coach lesson detail", async () => {
    const { html } = await renderEmail("coach_booking_request", coachPayload);
    expect(html).toContain("/coach/lessons/77777777-8888-9999-aaaa-bbbbbbbbbbbb");
  });

  it("produces non-empty plain text alternative", async () => {
    const { text } = await renderEmail("coach_booking_request", coachPayload);
    expect(text.length).toBeGreaterThan(0);
  });
});

describe("renderEmail — coach_booking_request BATCH (ADR 031 email backup)", () => {
  const batchPayload = {
    kind: "booking_request_batch" as const,
    listTitle: "New batch request",
    batchId: "88888888-9999-aaaa-bbbb-cccccccccccc",
    lessonCount: 3,
    pendingCount: 3,
    approvedCount: 0,
    firstStartsAtLocalDisplay: "Tue, Oct 27, 2026 at 4:30 PM",
    lastStartsAtLocalDisplay: "Thu, Oct 29, 2026 at 5:30 PM",
    locationName: "Egret Park",
  };

  it("uses the FIRST starts-at in the subject (batch payloads carry no startsAtLocalDisplay)", async () => {
    const { subject } = await renderEmail("coach_booking_request", batchPayload);
    expect(subject).toBe("New booking request: Tue, Oct 27, 2026 at 4:30 PM");
  });

  it("renders the lesson count, pool, and first/last times in the body", async () => {
    const { html, text } = await renderEmail("coach_booking_request", batchPayload);
    expect(html).toContain("3 lessons");
    expect(html).toContain("Egret Park");
    expect(html).toContain("Tue, Oct 27, 2026 at 4:30 PM");
    expect(html).toContain("Thu, Oct 29, 2026 at 5:30 PM");
    expect(text).toContain("3 lessons");
  });

  it("renders the deep link scoped to the batch", async () => {
    const { html } = await renderEmail("coach_booking_request", batchPayload);
    expect(html).toContain(
      "/coach/lessons?batch=88888888-9999-aaaa-bbbb-cccccccccccc",
    );
  });

  it("renders a mixed-approval mix sentence when some are auto-approved", async () => {
    const mixed = {
      ...batchPayload,
      pendingCount: 2,
      approvedCount: 1,
    };
    const { html } = await renderEmail("coach_booking_request", mixed);
    expect(html ?? "").toContain("1 auto-approved");
    expect(html ?? "").toContain("2 waiting");
  });

  it("renders an all-auto-approved mix sentence", async () => {
    const allApproved = {
      ...batchPayload,
      pendingCount: 0,
      approvedCount: 3,
    };
    const { html } = await renderEmail("coach_booking_request", allApproved);
    expect(html ?? "").toContain("auto-approved");
    expect((html ?? "").toLowerCase()).toContain("heads-up");
  });

  it("never leaks a swimmer last name (batch payload carries no last-name field)", async () => {
    const { html, text } = await renderEmail("coach_booking_request", batchPayload);
    // No swimmer names in the batch summary; sanity-check nothing from the
    // payload surfaces unexpected PII.
    expect((html ?? "").toLowerCase()).not.toContain("rodriguez");
    expect(text.toLowerCase()).not.toContain("rodriguez");
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

  it("lesson_confirmed renders coach-scheduled copy when initiatedBy='coach'", async () => {
    const { html, text, subject } = await renderEmail("lesson_confirmed", {
      ...basePayload,
      initiatedBy: "coach",
      actorRole: "coach",
    });
    // Subject stays the same ("Lesson confirmed: ..."); only the body copy
    // branches. The coach's name appears somewhere in the heading or body.
    expect(subject).toBe("Lesson confirmed: Sat, Nov 1, 2026 at 10:30 AM");
    expect(html ?? "").toContain("Jason");
    expect(text).toContain("Jason");
    expect(html ?? "").toContain("scheduled a lesson");
    expect(text).toContain("scheduled a lesson");
  });

  it("lesson_confirmed renders parent-booked copy when initiatedBy='parent'", async () => {
    const { html, text } = await renderEmail("lesson_confirmed", {
      ...basePayload,
      initiatedBy: "parent",
      actorRole: "parent",
    });
    // The parent-copy heading is "You're on the schedule." — plain-text
    // uppercases it, so match case-insensitively on just the key phrase.
    expect((html ?? "").toLowerCase()).toContain("on the schedule");
    expect(text.toLowerCase()).toContain("on the schedule");
    expect(html ?? "").not.toContain("scheduled a lesson for");
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
