// Internal types for the batch-booking email path (ADR 030). The outbox
// row's payload column stores this shape for batch-scoped events. Not
// exported through @swim-app/shared — API-only, mirroring ./types.ts for
// per-lesson rows.
//
// Per-lesson emails use ./types.ts's LessonEmailPayload; batch emails use
// this file. The two namespaces never share a row (CHECK: lesson_id XOR
// batch_id on lesson_email_outbox), so there is no mixed shape.

import type { LessonEmailLocation } from "./types";

export type BatchEmailEvent = "batch_booked" | "batch_approved" | "batch_canceled";

export type BatchLessonStatus = "pending" | "approved" | "canceled";

export interface BatchEmailLesson {
  lessonId: string;
  // Full ISO string. Rendering formats to LA display at send time.
  startsAtUtc: string;
  durationMinutes: number;
  status: BatchLessonStatus;
  // The SEQUENCE value that was issued for this lesson's VEVENT in the
  // triggering outbox write. For batch_booked and batch_approved, this is
  // the pre-bump value (what the invite's SEQUENCE: line should be). For
  // batch_canceled, it is the pre-bump value for the CANCEL. The sender's
  // filter compares current_calendar_sequence to this value + 1 to detect
  // "has this lesson been changed since we wrote this payload."
  calendarSequence: number;
}

export interface BatchPatternPair {
  weekday: number;
  timeOfDay: string;
}

export interface BatchEmailPayload {
  batchId: string;
  mode: "manual" | "weekly";
  // Present only for mode='weekly'.
  weekly?: {
    pattern: BatchPatternPair[];
    startDate: string;
    weeks: number;
  };
  location: LessonEmailLocation;
  durationMinutes: number;
  swimmerFirstNames: string[];
  lessons: BatchEmailLesson[];
}
