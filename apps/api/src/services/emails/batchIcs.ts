// Multi-VEVENT .ics builder for batch emails (ADR 030). Each VEVENT uses
// the per-lesson UID so later per-lesson reschedules and cancels supersede
// via SEQUENCE:N on the standard outbox events; nothing here uses an
// RRULE.
//
// The sender applies the send-time filter BEFORE calling this builder, so
// `lessons` here is already narrowed to the subset that still matches the
// payload snapshot. If `lessons` is empty, no attachment is produced.

import { ICS_ORGANIZER_EMAIL, ICS_UID_DOMAIN } from "./ics";
import type { BatchEmailPayload } from "./batchTypes";

export type BatchIcsMethod = "REQUEST" | "CANCEL";

export interface BatchIcsFilteredLesson {
  lessonId: string;
  startsAtUtc: string;
  durationMinutes: number;
  calendarSequence: number;
}

export interface BuildBatchIcsOptions {
  method: BatchIcsMethod;
  payload: BatchEmailPayload;
  // Lessons that passed the send-time filter — only these produce VEVENTs.
  // The caller provides the already-filtered list.
  lessons: BatchIcsFilteredLesson[];
  now?: Date;
}

export interface BuiltBatchIcs {
  body: string;
  // Count of VEVENTs produced; useful for logging.
  eventCount: number;
  filename: string;
}

export function buildBatchIcs(opts: BuildBatchIcsOptions): BuiltBatchIcs | null {
  const { method, payload, lessons } = opts;
  if (lessons.length === 0) return null;
  const now = opts.now ?? new Date();
  const dtstamp = formatUtc(now);
  const status = method === "REQUEST" ? "CONFIRMED" : "CANCELLED";
  const summaryBase = `Swim lesson: ${formatSwimmerListSummary(payload.swimmerFirstNames)}`;
  const location = formatLocation(payload);
  const description = formatDescription(payload);

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Axiom Aquatics//Booking//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${method}`,
  ];
  for (const lesson of lessons) {
    const dtstart = formatUtc(new Date(lesson.startsAtUtc));
    const dtend = formatUtc(
      new Date(new Date(lesson.startsAtUtc).getTime() + lesson.durationMinutes * 60_000),
    );
    lines.push(
      "BEGIN:VEVENT",
      `UID:${lesson.lessonId}@${ICS_UID_DOMAIN}`,
      `SEQUENCE:${lesson.calendarSequence}`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${dtstart}`,
      `DTEND:${dtend}`,
      `SUMMARY:${escapeIcs(summaryBase)}`,
      `LOCATION:${escapeIcs(location)}`,
      `DESCRIPTION:${escapeIcs(description)}`,
      `STATUS:${status}`,
      `ORGANIZER;CN=Axiom Aquatics:MAILTO:${ICS_ORGANIZER_EMAIL}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");

  return {
    body: lines.join("\r\n") + "\r\n",
    eventCount: lessons.length,
    filename: method === "REQUEST" ? "lessons.ics" : "lessons-canceled.ics",
  };
}

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

function formatLocation(payload: BatchEmailPayload): string {
  const { location } = payload;
  return `${location.name}, ${location.address}, ${location.city}, ${location.state} ${location.zip}`;
}

function formatDescription(_payload: BatchEmailPayload): string {
  // The batch's lessons each have their own per-lesson deep link that
  // parents reach from the dashboard; the per-event description here points
  // generically at the dashboard rather than including a specific lesson
  // id (that lives in the UID). Keeps the invite's description identical
  // across every VEVENT in the attachment.
  return "View your lessons in Axiom Aquatics.";
}
