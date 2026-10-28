import { and, eq, inArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { db } from "../db/client";
import * as schema from "../db/schema";
import { logger as rootLogger } from "../logger";
import { enqueueCoachNotification } from "../services/notifications/outbox";
import { sendCoachNotification } from "../services/notifications/sender";
import { getActiveCoachProfile } from "./coachProfile";

const log = rootLogger.child({ component: "lesson-notify" });

// Pending-work tracker. Each notify* stub fires an async IIFE for the
// enqueue + send work; the IIFE promise is tracked here so tests can
// await settlement before cleanup. In production this is unused — the
// Set adds a promise and removes it on settle, bounded by the stub's own
// completion.
const inFlight = new Set<Promise<unknown>>();

function track(promise: Promise<unknown>): void {
  inFlight.add(promise);
  // Attach a finally handler to always remove the entry. Swallow any
  // rejection the handler itself might cause (shouldn't happen) so this
  // path never surfaces an unhandled rejection.
  promise.catch(() => {}).finally(() => {
    inFlight.delete(promise);
  });
}

/**
 * Test-only helper. Waits until every pending notify* stub's async work
 * has settled. Call this in test teardown BEFORE deleting lessons,
 * batches, or households so the stub's INSERT / sender call completes
 * against still-live FK targets. New work spawned while draining is also
 * awaited (allSettled loops until the set is empty).
 */
export async function __settlePendingCoachAlertsForTests(): Promise<void> {
  while (inFlight.size > 0) {
    await Promise.allSettled(Array.from(inFlight));
  }
}

// Approval gate: approval is required if the household has no prior approved
// or completed lessons at this specific location. Declined, canceled, expired,
// no_show, and pending lessons do not count toward the approval threshold.
export async function needsApproval(
  householdId: string,
  locationId: string,
  tx: PostgresJsDatabase<typeof schema>,
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

// Parent-initiated booking (ADR 031). Fires AFTER the lesson transaction
// commits — a tiny atomicity gap we accept for now (the lesson is already
// in the DB; if the notification insert fails, the coach checks the
// dashboard). A future refinement plumbs `tx` through this call site.
export function notifyBookingCreated(lessonId: string, autoApproved: boolean): void {
  const work = (async () => {
    try {
      const coach = await getActiveCoachProfile();
      if (!coach) return;
      // Auto-approved rows map to 'auto_approved_summary'; new requests to
      // 'booking_request'. The sender's preferences check decides whether
      // to deliver, suppress to summary, or email-backup.
      const category = autoApproved ? "auto_approved_summary" : "booking_request";
      const result = await db.transaction(async (tx) => {
        return await enqueueCoachNotification(tx, {
          coachProfileId: coach.id,
          category,
          lessonId,
        });
      });
      if (result.notificationId) {
        await sendCoachNotification(result.notificationId);
      }
    } catch (err) {
      log.error(
        { lessonId, autoApproved, err: err instanceof Error ? err.message : String(err) },
        "notifyBookingCreated failed to enqueue coach notification",
      );
    }
  })();
  track(work);
}

// Coach-initiated approve/decline. Jason is the actor; he does not notify
// himself. Kept as a named no-op so the call sites can stay in place for a
// future multi-coach world where another coach's action does fire an alert.
export function notifyLessonApproved(_lessonId: string): void {}
export function notifyLessonDeclined(_lessonId: string): void {}

// Stub — wired in PR 8 (payments).
export function chargeLessonComplete(_lessonId: string): void {}

// Parent-initiated cancel or reschedule. The call site is shared between
// coach and parent paths; we skip the write when the actor is the coach
// via `skipIfCoach`.
export function notifyCoachOfChange(
  lessonId: string,
  changeKind: "canceled" | "rescheduled",
  options?: {
    actorIsCoach?: boolean;
    previousStartsAt?: Date | null;
  },
): void {
  if (options?.actorIsCoach) return;
  const work = (async () => {
    try {
      const coach = await getActiveCoachProfile();
      if (!coach) return;
      const result = await db.transaction(async (tx) => {
        return await enqueueCoachNotification(tx, {
          coachProfileId: coach.id,
          category: "parent_change",
          lessonId,
          changeKind,
          previousStartsAt: options?.previousStartsAt ?? null,
        });
      });
      if (result.notificationId) {
        await sendCoachNotification(result.notificationId);
      }
    } catch (err) {
      log.error(
        { lessonId, changeKind, err: err instanceof Error ? err.message : String(err) },
        "notifyCoachOfChange failed to enqueue coach notification",
      );
    }
  })();
  track(work);
}

// Batch-scoped coach notifications (ADR 030). One row per batch write with
// a summary payload — the inbox-noise argument that justifies one-email-
// per-batch on the parent side applies to the coach's channel too.
export function notifyBatchBookingCreated(
  batchId: string,
  _summary: { confirmedCount: number; pendingCount: number },
): void {
  const work = (async () => {
    try {
      const coach = await getActiveCoachProfile();
      if (!coach) return;
      const result = await db.transaction(async (tx) => {
        return await enqueueCoachNotification(tx, {
          coachProfileId: coach.id,
          category: "booking_request",
          batchId,
        });
      });
      if (result.notificationId) {
        await sendCoachNotification(result.notificationId);
      }
    } catch (err) {
      log.error(
        { batchId, err: err instanceof Error ? err.message : String(err) },
        "notifyBatchBookingCreated failed",
      );
    }
  })();
  track(work);
}

export type BatchChangeKind = "canceled_remaining";

export function notifyCoachOfBatchChange(
  batchId: string,
  _change: BatchChangeKind,
  _summary: { lessonCount: number },
): void {
  const work = (async () => {
    try {
      const coach = await getActiveCoachProfile();
      if (!coach) return;
      const result = await db.transaction(async (tx) => {
        return await enqueueCoachNotification(tx, {
          coachProfileId: coach.id,
          category: "parent_change",
          batchId,
          changeKind: "batch_canceled_remaining",
        });
      });
      if (result.notificationId) {
        await sendCoachNotification(result.notificationId);
      }
    } catch (err) {
      log.error(
        { batchId, err: err instanceof Error ? err.message : String(err) },
        "notifyCoachOfBatchChange failed",
      );
    }
  })();
  track(work);
}
