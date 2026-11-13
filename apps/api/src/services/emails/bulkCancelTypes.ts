// Internal types for the coach bulk-cancel email path (ADR 033). One row per
// family per bulk-cancel operation lives in lesson_email_outbox with event
// 'coach_bulk_cancel'; the row's payload column stores this shape. Not
// exported through @swim-app/shared -- API-only, mirroring ./types.ts and
// ./batchTypes.ts for their respective scopes.

import type { LessonDurationMinutes } from "@swim-app/shared";
import type { LessonEmailLocation } from "./types";

export interface BulkCancelEmailCancelledLesson {
  lessonId: string;
  // Full ISO. Rendering formats to LA display at send time; the pre-formatted
  // startsAtLocalDisplay is also carried so a renderer can show it without
  // re-doing the timezone math.
  startsAtUtc: string;
  endsAtUtc: string;
  startsAtLocalDisplay: string;
  durationMinutes: LessonDurationMinutes;
  swimmerFirstNames: string[];
  location: LessonEmailLocation;
  // The SEQUENCE value that was issued for this lesson's VEVENT in the
  // triggering outbox write. Pre-bump value — the CANCEL VEVENT uses this.
  calendarSequence: number;
  // True when the lesson had a REQUEST invite shipped before the bulk cancel
  // (lessons.calendar_invite_sent_at is non-null). Only invited lessons
  // produce a CANCEL VEVENT; pending-only cancellations are listed in the
  // body but get no VEVENT.
  wasInvited: boolean;
}

export interface BulkCancelEmailDeclinedRequest {
  lessonId: string;
  startsAtLocalDisplay: string;
  durationMinutes: LessonDurationMinutes;
  swimmerFirstNames: string[];
  location: LessonEmailLocation;
}

export interface BulkCancelEmailPayload {
  // Keyed to the bulk_cancellations row for debugging and ICS UID prefix
  // continuity.
  bulkCancellationId: string;
  householdId: string;
  // Pre-formatted LA display strings.
  startDateLocal: string;
  endDateLocal: string;
  // Pre-formatted LA wall-clock window labels when the operation targeted
  // a time window; null when the operation covered the whole day. Example:
  // "4:00 PM", "6:00 PM".
  startTimeLocal: string | null;
  endTimeLocal: string | null;
  // When the operation filtered by pool, the pool name. Null = every pool
  // (operation didn't scope to one).
  locationName: string | null;
  // Coach's message to the family, verbatim. Capped at the shared bulk-cancel
  // message length by the API; null when the coach didn't type anything.
  message: string | null;
  // Snapshotted from profiles.full_name at outbox-write time, like every
  // other email path.
  coachFirstName: string | null;
  // Deep link to the family's dashboard lessons list.
  deepLink: string;
  // Approved lessons that got cancelled. Chronological.
  cancelledLessons: BulkCancelEmailCancelledLesson[];
  // Pending requests that got declined by the operation. Chronological.
  declinedRequests: BulkCancelEmailDeclinedRequest[];
  // ADR 036 Phase 7: sum of refunds across every lesson in this family's
  // slice of the bulk cancel (approved refunds + pending request refunds).
  // Null → no refund landed (all free lessons / pre-Phase-4 / already
  // refunded). When both this and newBalanceCents are set, the email
  // renders a one-line "Refunded $X. New balance: $Y." for the family.
  refundAmountCents: number | null;
  newBalanceCents: number | null;
}
