// Internal types for the batch-booking email path (ADR 030). The outbox
// row's payload column stores this shape for batch-scoped events. Not
// exported through @swim-app/shared -- API-only, mirroring ./types.ts for
// per-lesson rows.
//
// Per-lesson emails use ./types.ts's LessonEmailPayload; batch emails use
// this file. The two namespaces never share a row (CHECK: lesson_id XOR
// batch_id on lesson_email_outbox), so there is no mixed shape.
//
// The pattern pair type is re-exported from the shared Zod schema so the
// stored payload and this declaration cannot drift (durationMinutes etc.
// come along for free).

import type { LessonDurationMinutes, BatchPatternPair as SharedBatchPatternPair } from "@swim-app/shared";
import type { LessonEmailLocation } from "./types";

export type BatchEmailEvent = "batch_booked" | "batch_approved" | "batch_canceled";

export type BatchLessonStatus = "pending" | "approved" | "canceled";

export interface BatchEmailLesson {
  lessonId: string;
  // Full ISO string. Rendering formats to LA display at send time.
  startsAtUtc: string;
  durationMinutes: LessonDurationMinutes;
  status: BatchLessonStatus;
  // Per-lesson swimmer first names, alphabetical. Snapshotted at outbox-
  // write time (ADR 030 phase 2). Lets the summary email render which
  // kids are on each lesson when a batch mixes swimmer sets.
  swimmerFirstNames: string[];
  // The SEQUENCE value that was issued for this lesson's VEVENT in the
  // triggering outbox write. For batch_booked and batch_approved, this is
  // the pre-bump value (what the invite's SEQUENCE: line should be). For
  // batch_canceled, it is the pre-bump value for the CANCEL. The sender's
  // filter compares current_calendar_sequence to this value + 1 to detect
  // "has this lesson been changed since we wrote this payload."
  calendarSequence: number;
  // Only present on batch_canceled rows. True when the lesson had a prior
  // REQUEST invite shipped (calendar_invite_sent_at is non-null); the sender
  // emits a CANCEL VEVENT for it so the parent's calendar app removes the
  // original entry. False means the lesson was pending-only and never had
  // an invite: it still appears in the email body but gets no VEVENT. See
  // ADR 030.
  wasInvited?: boolean;
}

// The embedded weekly block is an archival snapshot of the pattern as stored
// in booking_batches. Nothing re-expands it, so swimmerIds is optional here
// to match rows written before ADR 030 phase 2 that don't carry per-pair
// swimmer sets. New writes always include it.
export type BatchPatternPair = Omit<SharedBatchPatternPair, "swimmerIds"> & {
  swimmerIds?: string[];
};

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
  swimmerFirstNames: string[];
  lessons: BatchEmailLesson[];
}
