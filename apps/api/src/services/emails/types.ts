// Internal types for the lesson email outbox. Not exported through
// @swim-app/shared — these are API-only. See ADR 028.

export type LessonEmailEvent =
  | "booking_requested"
  | "lesson_confirmed"
  | "request_declined"
  | "request_expired"
  | "lesson_canceled"
  | "lesson_rescheduled"
  // Email backup to the coach when a new booking request lands and the
  // coach has zero active push subscriptions. Payload is a
  // CoachNotificationPayload (BookingRequestLessonPayload), NOT a
  // LessonEmailPayload — the render dispatch picks the right template.
  // See ADR 031.
  | "coach_booking_request"
  // One row per family per coach bulk-cancel operation (ADR 033). Payload
  // is a BulkCancelEmailPayload (see ./bulkCancelTypes.ts), NOT a
  // LessonEmailPayload. Row scope is (bulk_cancellation_id, household_id),
  // never a lesson or batch id.
  | "coach_bulk_cancel";

export type LessonEmailStatus =
  | "pending"
  | "sending"
  | "sent"
  | "failed"
  | "skipped"
  | "superseded"
  | "abandoned";

export type IcsMethod = "REQUEST" | "CANCEL";

// Who performed the state change that triggered this email. Shapes the
// body copy ("Jason moved this lesson" vs "A household member canceled…").
export type EmailActorRole = "coach" | "parent" | "system";

export interface LessonEmailLocation {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  // True when the location is a specific household's residence. The whole
  // address is safe for this email because the recipients are that same
  // household — unlike the ADR 027 Google Calendar carve-out.
  isHomePool: boolean;
}

// Frozen render inputs. Written into lesson_email_outbox.payload at outbox
// write time; a later edit on the lesson row never retroactively repaints a
// scheduled email. Phase 1 uses this to render a plain-text body; phase 2
// consumes the same shape in React Email templates + the .ics builder.
export interface LessonEmailPayload {
  // Keyed to the lesson for render-time look-ups (deep link, ics UID).
  lessonId: string;
  // Full ISO strings. The renderer formats to LA display using
  // startsAtLocalDisplay/endsAtLocalDisplay below.
  startsAtUtc: string;
  endsAtUtc: string;
  durationMinutes: number;
  // Pre-formatted LA display strings so the renderer doesn't need to carry
  // timezone logic. Example: "Sat, Nov 1, 2026 at 10:30 AM".
  startsAtLocalDisplay: string;
  endsAtLocalDisplay: string;
  // First names only — never last names, birth dates, or notes. See
  // docs/accounts.md.
  swimmerFirstNames: string[];
  location: LessonEmailLocation;
  // Absolute deep link to the lesson detail in the web app. Example:
  // https://dev.axiomaquatics.io/dashboard/lessons/<uuid>
  deepLink: string;
  actorRole: EmailActorRole;
  // Reschedule only. ISO + display. Null for everything else.
  previousStartsAtUtc: string | null;
  previousStartsAtLocalDisplay: string | null;
  // Coach's first name, snapshotted from profiles.full_name at outbox-write
  // time. Used throughout the templates ("Jason canceled this lesson") so
  // a later rename doesn't retroactively repaint a scheduled email. Null
  // falls back to "The coach" in the renderer.
  coachFirstName: string | null;
  // Decline only. Null when the coach didn't give a reason, or event !=
  // request_declined.
  declineReason: string | null;
  // booking_requested only. Null for everything else.
  expiresAtLocalDisplay: string | null;
  // Whole-hour difference between the lesson start and the pending request's
  // expiresAt, snapshotted from availability_config.bookingMinAdvanceHours at
  // booking time. Non-null for booking_requested + request_expired, which
  // mention this value in body copy. Null for events that don't reference it.
  expiryHoursBeforeStart: number | null;
  // Who initiated the lesson itself (not who caused the current state
  // transition — that's `actorRole`). Set for `lesson_confirmed`: 'parent'
  // when a parent booked, 'coach' when a coach booked (ADR 029). The
  // LessonConfirmed template branches on this to render coach-scheduled
  // copy. Null on every other event.
  initiatedBy: "parent" | "coach" | null;
}
