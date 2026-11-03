// Multi-VEVENT .ics builder for the coach bulk-cancel email (ADR 033). One
// METHOD:CANCEL VCALENDAR carries one VEVENT per invited cancelled lesson,
// keyed by the per-lesson UID so the parent's calendar app removes the
// original entry. Pending-only cancellations are not represented here (no
// prior invite ever shipped); the template still lists them in the body.
//
// The caller filters `cancelledLessons` to the subset that still matches the
// payload snapshot before passing them in — same send-time filter idea as
// the batch sender's wasInvited check. If the filtered list is empty, no
// attachment is produced.

import { ICS_ORGANIZER_EMAIL, ICS_UID_DOMAIN } from "./ics";
import type { BulkCancelEmailCancelledLesson } from "./bulkCancelTypes";

export interface BulkCancelIcsFilteredLesson {
  lessonId: string;
  startsAtUtc: string;
  durationMinutes: number;
  swimmerFirstNames: string[];
  locationName: string;
  locationAddress: string;
  locationCity: string;
  locationState: string;
  locationZip: string;
  // True when the lesson's location is a specific family's home pool.
  // Threaded through from BulkCancelEmailCancelledLesson.location so a
  // future redaction (matching ADR 027's Google Calendar carve-out, pending
  // the kids'-data legal review flagged in docs/accounts.md) can branch
  // inside this builder without re-plumbing the shape. The current builder
  // emits the full address regardless; the family only ever receives their
  // own home-pool address, which `types.ts` documents as safe in emails.
  isHomePool: boolean;
  calendarSequence: number;
}

export interface BuildBulkCancelIcsOptions {
  lessons: BulkCancelIcsFilteredLesson[];
  now?: Date;
}

export interface BuiltBulkCancelIcs {
  body: string;
  eventCount: number;
  filename: string;
}

export function buildBulkCancelIcs(opts: BuildBulkCancelIcsOptions): BuiltBulkCancelIcs | null {
  if (opts.lessons.length === 0) return null;
  const dtstamp = formatUtc(opts.now ?? new Date());

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Axiom Aquatics//Booking//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:CANCEL",
  ];
  for (const lesson of opts.lessons) {
    const start = new Date(lesson.startsAtUtc);
    const end = new Date(start.getTime() + lesson.durationMinutes * 60_000);
    const summary = `Swim lesson: ${formatSwimmerListSummary(lesson.swimmerFirstNames)}`;
    const location = `${lesson.locationName}, ${lesson.locationAddress}, ${lesson.locationCity}, ${lesson.locationState} ${lesson.locationZip}`;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${lesson.lessonId}@${ICS_UID_DOMAIN}`,
      `SEQUENCE:${lesson.calendarSequence}`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${formatUtc(start)}`,
      `DTEND:${formatUtc(end)}`,
      `SUMMARY:${escapeIcs(summary)}`,
      `LOCATION:${escapeIcs(location)}`,
      `DESCRIPTION:${escapeIcs("View your lessons in Axiom Aquatics.")}`,
      "STATUS:CANCELLED",
      `ORGANIZER;CN=Axiom Aquatics:MAILTO:${ICS_ORGANIZER_EMAIL}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");

  return {
    body: lines.join("\r\n") + "\r\n",
    eventCount: opts.lessons.length,
    filename: "lessons-canceled.ics",
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

// Type guard for the sender's filter step: payload lessons expose everything
// needed to build an ICS VEVENT, but the filter is applied against live
// lesson state. Converting the payload entry to the filtered shape is a
// small projection the caller does once per kept lesson.
export function cancelledLessonToIcsFiltered(
  lesson: BulkCancelEmailCancelledLesson,
): BulkCancelIcsFilteredLesson {
  return {
    lessonId: lesson.lessonId,
    startsAtUtc: lesson.startsAtUtc,
    durationMinutes: lesson.durationMinutes,
    swimmerFirstNames: lesson.swimmerFirstNames,
    locationName: lesson.location.name,
    locationAddress: lesson.location.address,
    locationCity: lesson.location.city,
    locationState: lesson.location.state,
    locationZip: lesson.location.zip,
    isHomePool: lesson.location.isHomePool,
    calendarSequence: lesson.calendarSequence,
  };
}
