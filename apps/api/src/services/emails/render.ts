// Phase 1 placeholder renderer: builds a short subject + plain-text body
// from the frozen outbox payload. Enough to see end-to-end delivery in
// Mailpit while React Email templates and .ics attachments wait for phase
// 2. The phase-2 renderer will consume the same `LessonEmailPayload` shape.
//
// Subject format: "<Status>: <Weekday>, <Mon D>, <Time>" — colon, no em
// dash, matching docs/plans/parent-booking-emails.md.

import type { LessonEmailEvent, LessonEmailPayload } from "./types";

export interface RenderedEmail {
  subject: string;
  text: string;
}

const SUBJECT_PREFIX: Record<LessonEmailEvent, string> = {
  booking_requested: "Request received",
  lesson_confirmed: "Lesson confirmed",
  request_declined: "Request not booked",
  request_expired: "Request expired",
  lesson_canceled: "Lesson canceled",
  lesson_rescheduled: "Lesson rescheduled",
};

const HEADLINE: Record<LessonEmailEvent, string> = {
  booking_requested: "We got your request.",
  lesson_confirmed: "You're on the schedule.",
  request_declined: "This request wasn't booked.",
  request_expired: "This request expired.",
  lesson_canceled: "This lesson was canceled.",
  lesson_rescheduled: "This lesson moved.",
};

export function renderEmail(event: LessonEmailEvent, payload: LessonEmailPayload): RenderedEmail {
  const swimmerList = formatSwimmerList(payload.swimmerFirstNames);
  const subject = `${SUBJECT_PREFIX[event]}: ${payload.startsAtLocalDisplay}`;
  const lines: string[] = [HEADLINE[event], ""];

  switch (event) {
    case "booking_requested":
      lines.push(
        `We received your request to book a swim lesson for ${swimmerList}.`,
        payload.expiresAtLocalDisplay
          ? `Jason will respond before ${payload.expiresAtLocalDisplay}, or the request will expire.`
          : "Jason will respond soon.",
      );
      break;
    case "lesson_confirmed":
      // Phase 1 does not attach the .ics yet (phase 2 wires it); don't
      // promise an attachment the reader won't see.
      lines.push(`Confirmed for ${swimmerList}.`);
      break;
    case "request_declined":
      lines.push(
        payload.declineReason
          ? `Jason wasn't able to confirm this one: ${payload.declineReason}.`
          : "Jason wasn't able to confirm this one.",
        "You're welcome to try another slot. Availability updates in real time in the app.",
      );
      break;
    case "request_expired":
      lines.push(
        "Requests expire 16 hours before the lesson's start time if Jason hasn't gotten to them.",
        "The slot is open again. Grab it or pick another in the app.",
      );
      break;
    case "lesson_canceled":
      lines.push(
        payload.actorRole === "coach"
          ? "Jason canceled this lesson. If you'd like to rebook, availability is open in the app."
          : "A household member canceled this lesson. If this was a mistake, please book again. The slot may still be open.",
      );
      break;
    case "lesson_rescheduled":
      lines.push(
        payload.actorRole === "coach"
          ? "Jason moved this lesson."
          : "A household member rescheduled this lesson. Everyone in your household is getting this email so your calendars stay in sync.",
      );
      if (payload.previousStartsAtLocalDisplay) {
        lines.push(`Was: ${payload.previousStartsAtLocalDisplay}`);
      }
      lines.push(`Now: ${payload.startsAtLocalDisplay}`);
      break;
  }

  lines.push(
    "",
    `Swimmer: ${swimmerList}`,
    `Date and time: ${payload.startsAtLocalDisplay} (America/Los_Angeles)`,
    `Location: ${formatLocation(payload)}`,
    "",
    `View this lesson: ${payload.deepLink}`,
  );

  return { subject, text: lines.join("\n") };
}

function formatSwimmerList(names: readonly string[]): string {
  if (names.length === 0) return "your swimmer";
  if (names.length === 1) return names[0] ?? "your swimmer";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function formatLocation(payload: LessonEmailPayload): string {
  const { location } = payload;
  const addressLine = `${location.address}, ${location.city}, ${location.state} ${location.zip}`;
  return `${location.name}, ${addressLine}`;
}
