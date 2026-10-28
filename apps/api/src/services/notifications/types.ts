// Internal types for the coach notification outbox. Not exported through
// @swim-app/shared — these are API-only. See ADR 031.

export type CoachNotificationCategory =
  | "booking_request"
  | "request_expiring_soon"
  | "parent_change"
  | "calendar_disconnected"
  | "auto_approved_summary"
  | "daily_summary";

export type CoachNotificationUrgency = "standard" | "urgent";

export type CoachNotificationPushStatus =
  | "pending"
  | "held"
  | "summarized"
  | "sending"
  | "sent"
  | "failed"
  | "skipped"
  | "superseded"
  | "abandoned";

export type ParentChangeKind =
  | "canceled"
  | "rescheduled"
  | "batch_canceled_remaining";

// Shared fields on every payload. The sender composes the push body from
// `payload + lock_screen_detail` so a later preference change does not
// retroactively repaint a scheduled push.
interface BasePayload {
  // Short label for the in-app list ("New request", "Lesson canceled", etc.).
  // Composed at enqueue time so the renderer stays pure.
  listTitle: string;
}

export interface BookingRequestLessonPayload extends BasePayload {
  kind: "booking_request_lesson";
  lessonId: string;
  swimmerFirstNamesWithInitial: string[];
  swimmerFullNames: string[];
  startsAtLocalDisplay: string;
  locationName: string;
}

export interface BookingRequestBatchPayload extends BasePayload {
  kind: "booking_request_batch";
  batchId: string;
  lessonCount: number;
  pendingCount: number;
  approvedCount: number;
  firstStartsAtLocalDisplay: string;
  lastStartsAtLocalDisplay: string;
  locationName: string;
}

export interface ParentChangeLessonPayload extends BasePayload {
  kind: "parent_change_lesson";
  lessonId: string;
  changeKind: Exclude<ParentChangeKind, "batch_canceled_remaining">;
  swimmerFirstNamesWithInitial: string[];
  swimmerFullNames: string[];
  startsAtLocalDisplay: string;
  previousStartsAtLocalDisplay: string | null;
  locationName: string;
}

export interface ParentChangeBatchPayload extends BasePayload {
  kind: "parent_change_batch";
  batchId: string;
  changeKind: "batch_canceled_remaining";
  lessonCount: number;
  locationName: string;
}

export interface RequestExpiringSoonPayload extends BasePayload {
  kind: "request_expiring_soon";
  lessonId: string;
  swimmerFirstNamesWithInitial: string[];
  swimmerFullNames: string[];
  startsAtLocalDisplay: string;
  expiresAtLocalDisplay: string;
  locationName: string;
}

export interface AutoApprovedPayload extends BasePayload {
  kind: "auto_approved";
  lessonId: string;
  swimmerFirstNamesWithInitial: string[];
  swimmerFullNames: string[];
  startsAtLocalDisplay: string;
  locationName: string;
}

export interface CalendarDisconnectedPayload extends BasePayload {
  kind: "calendar_disconnected";
  needsReconnectSinceUtc: string;
}

export interface DailySummaryPayload extends BasePayload {
  kind: "daily_summary";
  // ISO date (YYYY-MM-DD) in LA. The partial unique index indexes
  // (profile_id, payload->>'dateLocal') so a daily summary is unique per
  // coach per LA date.
  dateLocal: string;
  lessonCount: number;
  firstLessonTimeLocal: string | null;
  firstLessonPoolName: string | null;
  pendingRequestCount: number;
  heldAlertCount: number;
}

export type CoachNotificationPayload =
  | BookingRequestLessonPayload
  | BookingRequestBatchPayload
  | ParentChangeLessonPayload
  | ParentChangeBatchPayload
  | RequestExpiringSoonPayload
  | AutoApprovedPayload
  | CalendarDisconnectedPayload
  | DailySummaryPayload;
