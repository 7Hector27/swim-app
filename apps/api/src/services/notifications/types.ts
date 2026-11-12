// Internal types for the coach notification outbox. Not exported through
// @swim-app/shared — these are API-only. See ADR 031.

export type CoachNotificationCategory =
  | "booking_request"
  | "request_expiring_soon"
  | "parent_change"
  | "calendar_disconnected"
  | "auto_approved_summary"
  | "daily_summary"
  | "account_deleted"
  | "cash_refund_needs_manual_handling";

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

// ADR 034. Written when a parent closes their account. No lesson_id /
// batch_id is attached because the referenced family is gone; the
// payload carries only the freed-up lesson start times, pre-formatted
// to LA wall-time so the renderer stays pure. Raw ISO strings are kept
// alongside the display list for downstream tooling.
export interface AccountDeletedPayload extends BasePayload {
  kind: "account_deleted";
  cancelledLessonTimesUtc: string[];
  cancelledLessonTimesLocalDisplay: string[];
  deletedAtUtc: string;
}

// ADR 036 Phase 8 Part B Stop 2. Written when a cash_refund_jobs row
// lands in `status = 'needs_manual_handling'` (either because the
// refundable residual couldn't be matched to a live card payment at
// insert, or because the drain exhausted its retries). The payload
// carries the Stripe payment intent id so Jason can copy-paste it into
// the Stripe dashboard — we never snapshot a family name because a
// household may be anonymized when this notification fires.
export interface CashRefundNeedsManualHandlingPayload extends BasePayload {
  kind: "cash_refund_needs_manual_handling";
  jobId: string;
  amountCents: number;
  // Human-safe label produced by `reasonForBanner` in services/balance/
  // notifications.ts. Short enough to render on the bell row and the
  // lock-screen push body.
  reason: string;
  // Null for the direct-needs-manual case (unmatched residual).
  stripePaymentIntentId: string | null;
}

export type CoachNotificationPayload =
  | BookingRequestLessonPayload
  | BookingRequestBatchPayload
  | ParentChangeLessonPayload
  | ParentChangeBatchPayload
  | RequestExpiringSoonPayload
  | AutoApprovedPayload
  | CalendarDisconnectedPayload
  | DailySummaryPayload
  | AccountDeletedPayload
  | CashRefundNeedsManualHandlingPayload;
