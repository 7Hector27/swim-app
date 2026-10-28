import { and, eq, inArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../db/schema";
import { logger as rootLogger } from "../logger";
import { enqueueCoachNotification, resolveCoachForNotification } from "../services/notifications/outbox";
import { sendCoachNotification } from "../services/notifications/sender";

const log = rootLogger.child({ component: "lesson-notify" });

type Tx = PostgresJsDatabase<typeof schema>;

// Pending send-microtask tracker. Each queueCoachNotificationSend call
// registers its send Promise so tests can await settlement before cleaning
// up the lesson row that FK-anchors the notification. In production the
// Set grows by one per request and clears a few hundred ms later.
const inFlight = new Set<Promise<unknown>>();

function track(promise: Promise<unknown>): void {
  inFlight.add(promise);
  promise.catch(() => {}).finally(() => {
    inFlight.delete(promise);
  });
}

/**
 * Test-only helper. Resolves once every pending `sendCoachNotification`
 * microtask has settled. Required before deleting lessons / batches /
 * households in a test so the send call completes against live FK
 * targets. Call before `cleanup*` in integration tests.
 */
export async function __settlePendingCoachAlertsForTests(): Promise<void> {
  while (inFlight.size > 0) {
    await Promise.allSettled(Array.from(inFlight));
  }
}

/**
 * Queue a post-commit `sendCoachNotification` call. Call this AFTER the
 * lesson transaction commits (not inside the tx). Idempotent when
 * `notificationId` is null — intended to be fed the return value of a
 * `notify*` enqueue that may be a no-op (e.g., coach-is-actor path).
 */
export function queueCoachNotificationSend(notificationId: string | null): void {
  if (!notificationId) return;
  const work = (async () => {
    try {
      await sendCoachNotification(notificationId);
    } catch (err) {
      log.error(
        { notificationId, err: err instanceof Error ? err.name : String(err) },
        "sendCoachNotification microtask failed",
      );
    }
  })();
  track(work);
}

// Approval gate: approval is required if the household has no prior approved
// or completed lessons at this specific location. Declined, canceled, expired,
// no_show, and pending lessons do not count toward the approval threshold.
export async function needsApproval(
  householdId: string,
  locationId: string,
  tx: Tx,
): Promise<boolean> {
  const approvedAtLocation = await tx
    .select({ id: schema.lessons.id })
    .from(schema.lessons)
    .where(
      and(
        eq(schema.lessons.householdId, householdId),
        eq(schema.lessons.locationId, locationId),
        inArray(schema.lessons.status, ["approved", "completed"]),
      ),
    )
    .limit(1);

  return approvedAtLocation.length === 0;
}

// Parent-initiated single-lesson booking (ADR 031). Writes the alert row
// inside the lesson's own transaction, so a transaction rollback also
// rolls back the notification. Returns the notification id so the caller
// can queue the send microtask after commit.
export async function notifyBookingCreated(
  tx: Tx,
  lessonId: string,
  autoApproved: boolean,
): Promise<string | null> {
  const coachProfileId = await resolveCoachForNotification(tx);
  if (!coachProfileId) return null;
  // Auto-approved rows map to 'auto_approved_summary'; new requests to
  // 'booking_request'. The sender's preferences check decides whether to
  // deliver, suppress to summary, or email-backup.
  const category = autoApproved ? "auto_approved_summary" : "booking_request";
  const result = await enqueueCoachNotification(tx, {
    coachProfileId,
    category,
    lessonId,
  });
  return result.notificationId;
}

// Coach-initiated approve/decline. Jason is the actor; he does not notify
// himself. Kept as a named no-op so the call sites can stay in place for a
// future multi-coach world where another coach's action does fire an alert.
export function notifyLessonApproved(_lessonId: string): void {}
export function notifyLessonDeclined(_lessonId: string): void {}

// Stub — wired in PR 8 (payments).
export function chargeLessonComplete(_lessonId: string): void {}

// Parent-initiated cancel or reschedule. The call site is shared between
// coach and parent paths; actor-is-coach is a no-op here.
export async function notifyCoachOfChange(
  tx: Tx,
  lessonId: string,
  changeKind: "canceled" | "rescheduled",
  options?: {
    actorIsCoach?: boolean;
    previousStartsAt?: Date | null;
  },
): Promise<string | null> {
  if (options?.actorIsCoach) return null;
  const coachProfileId = await resolveCoachForNotification(tx);
  if (!coachProfileId) return null;
  const result = await enqueueCoachNotification(tx, {
    coachProfileId,
    category: "parent_change",
    lessonId,
    changeKind,
    previousStartsAt: options?.previousStartsAt ?? null,
  });
  return result.notificationId;
}

// Batch-scoped coach notifications (ADR 030). One row per batch write with
// a summary payload — the inbox-noise argument that justifies one-email-
// per-batch on the parent side applies to the coach's channel too.
export async function notifyBatchBookingCreated(
  tx: Tx,
  batchId: string,
  _summary: { confirmedCount: number; pendingCount: number },
): Promise<string | null> {
  const coachProfileId = await resolveCoachForNotification(tx);
  if (!coachProfileId) return null;
  const result = await enqueueCoachNotification(tx, {
    coachProfileId,
    category: "booking_request",
    batchId,
  });
  return result.notificationId;
}

export type BatchChangeKind = "canceled_remaining";

export async function notifyCoachOfBatchChange(
  tx: Tx,
  batchId: string,
  _change: BatchChangeKind,
  _summary: { lessonCount: number },
): Promise<string | null> {
  const coachProfileId = await resolveCoachForNotification(tx);
  if (!coachProfileId) return null;
  const result = await enqueueCoachNotification(tx, {
    coachProfileId,
    category: "parent_change",
    batchId,
    changeKind: "batch_canceled_remaining",
  });
  return result.notificationId;
}
