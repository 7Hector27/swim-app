// RFC 5545 .ics builder for parent booking invites. Minimal by design — the
// invite only carries fields that Google Calendar, Apple Calendar, and
// Outlook actually render. See docs/plans/parent-booking-emails.md.
//
// Dates are written in UTC with a 'Z' suffix (DTSTART:YYYYMMDDTHHMMSSZ)
// rather than TZID=America/Los_Angeles. UTC avoids a VTIMEZONE block
// entirely, which keeps the file short and sidesteps VTIMEZONE DST edge
// cases that have broken Outlook renders in the past.
//
// UID is deterministic per lesson (`<lesson id>@axiomaquatics.io`) so a
// later CANCEL supersedes the earlier REQUEST in the user's calendar.
// SEQUENCE is the snapshot taken at outbox-write time and starts at 0.

import type { IcsMethod, LessonEmailPayload } from "./types";

export const ICS_UID_DOMAIN = "axiomaquatics.io";
export const ICS_ORGANIZER_EMAIL = "lessons@send.axiomaquatics.io";

export interface BuildIcsOptions {
  method: IcsMethod;
  sequence: number;
  payload: LessonEmailPayload;
  now?: Date;
}

export interface BuiltIcs {
  // The RFC 5545 body. CRLF line endings per spec.
  body: string;
  // The .ics UID. Exposed for logging / tests.
  uid: string;
  // Attachment filename. invite.ics for REQUEST, cancel.ics for CANCEL.
  filename: string;
}

export function buildIcs(opts: BuildIcsOptions): BuiltIcs {
  const { method, sequence, payload } = opts;
  const now = opts.now ?? new Date();
  const uid = `${payload.lessonId}@${ICS_UID_DOMAIN}`;
  const summary = `Swim lesson: ${formatSwimmerListSummary(payload.swimmerFirstNames)}`;
  const location = formatLocation(payload);
  const description = `View in Axiom Aquatics: ${payload.deepLink}`;
  const status = method === "REQUEST" ? "CONFIRMED" : "CANCELLED";
  const dtstamp = formatUtc(now);
  const dtstart = formatUtc(new Date(payload.startsAtUtc));
  const dtend = formatUtc(new Date(payload.endsAtUtc));

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Axiom Aquatics//Booking//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${method}`,
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `SEQUENCE:${sequence}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${dtstart}`,
    `DTEND:${dtend}`,
    `SUMMARY:${escapeIcs(summary)}`,
    `LOCATION:${escapeIcs(location)}`,
    `DESCRIPTION:${escapeIcs(description)}`,
    `STATUS:${status}`,
    `ORGANIZER;CN=Axiom Aquatics:MAILTO:${ICS_ORGANIZER_EMAIL}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return {
    body: lines.join("\r\n") + "\r\n",
    uid,
    filename: method === "REQUEST" ? "invite.ics" : "cancel.ics",
  };
}

// RFC 5545 TEXT escape: backslash, newline, comma, semicolon. No colons —
// those are field separators but legal inside values.
function escapeIcs(input: string): string {
  return input
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function formatUtc(date: Date): string {
  const year = date.getUTCFullYear().toString().padStart(4, "0");
  const month = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = date.getUTCDate().toString().padStart(2, "0");
  const hour = date.getUTCHours().toString().padStart(2, "0");
  const minute = date.getUTCMinutes().toString().padStart(2, "0");
  const second = date.getUTCSeconds().toString().padStart(2, "0");
  return `${year}${month}${day}T${hour}${minute}${second}Z`;
}

function formatSwimmerListSummary(names: readonly string[]): string {
  if (names.length === 0) return "swimmer";
  if (names.length === 1) return names[0] ?? "swimmer";
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

function formatLocation(payload: LessonEmailPayload): string {
  const { location } = payload;
  return `${location.name}, ${location.address}, ${location.city}, ${location.state} ${location.zip}`;
}
