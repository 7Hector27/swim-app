import { Router } from "express";
import { createHash, timingSafeEqual } from "crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "../db/client";
import { coachCalendarIntegrations, cronLeases, lessons } from "../db/schema";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../middleware/asyncHandler";
import { getEnv } from "../lib/env";
import { chargeLessonComplete } from "../lib/lessonApproval";
import {
  runFullSyncPass,
  runLightSyncPass,
  syncLessonToGoogle,
} from "../services/googleCalendarSync";
import { enqueueLessonEmail } from "../services/emails/outbox";
import { sendLessonEmailOutboxRow } from "../services/emails/sender";
import { drainLessonEmailOutbox, scrubLessonEmailPayloads } from "../services/emails/drain";
import {
  composeDailyCoachSummary,
  drainCoachNotifications,
  enqueueExpiringRequestReminders,
  releaseHeldCoachNotifications,
  scrubCoachNotificationPayloads,
} from "../services/notifications/drain";
import { runAccountDeletionRetryDrain } from "../services/accountDeletion";
import { safeCleanupErrSummary } from "../services/accountDeletion/cleanup";
import type { RequestHandler } from "express";

// Promote the per-tick light pass to a full pass when last_full_reconcile_at
// is older than this. 24 hours was chosen to catch drift (events deleted in
// Google, missed state changes) without a dedicated nightly worker.
const FULL_PASS_INTERVAL_MS = 24 * 60 * 60 * 1000;

// Cron tick lease name. Lives in the cron_leases table.
const CRON_TICK_LEASE_NAME = "cron/tick";

// Lease duration. Long enough for a normal tick (drains + sync passes)
// to finish; short enough that if the holder crashes before clearing
// held_until, the next tick takes over within a couple of minutes. The
// fire-and-forget microtasks (runFullSyncPass, syncLessonToGoogle, etc.)
// outlive the handler itself — the lease covers the synchronous handler
// work, not the background microtasks.
const CRON_TICK_LEASE_MS = 5 * 60 * 1000;

export const internalRouter = Router();

// SHA-256 both values before comparing so timingSafeEqual always operates on
// fixed-length digests — eliminating the timing oracle that a direct
// variable-length string comparison would leak on length mismatch.
function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

const requireCronSecret: RequestHandler = (req, res, next) => {
  const secret = getEnv().cronSecret;
  const provided = req.headers["cron-secret"];
  if (
    !secret ||
    typeof provided !== "string" ||
    !timingSafeEqual(sha256(provided), sha256(secret))
  ) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
};

// Attempts to atomically take the cron tick lease. Returns true when the
// caller now owns the lease, false when another holder is still active.
//
// Single statement: INSERT ... ON CONFLICT (name) DO UPDATE ... WHERE
// (held_until IS NULL OR held_until < now). The first-ever call inserts
// the row; every subsequent call hits ON CONFLICT and the setWhere
// clause only lets the UPDATE fire when the current holder's lease has
// been cleared or has expired. If the WHERE doesn't match, the row is
// untouched and RETURNING is empty — that's the exact "held by someone
// else" signal. No separate seed step; no race between INSERT and UPDATE.
//
// We deliberately avoid pg_advisory_lock. postgres-js pools connections,
// so session-scoped advisory locks can be acquired on one connection and
// released from another — leaking a lock forever.
async function tryAcquireCronTickLease(holder: string): Promise<boolean> {
  const now = new Date();
  const heldUntil = new Date(now.getTime() + CRON_TICK_LEASE_MS);
  const result = await db
    .insert(cronLeases)
    .values({ name: CRON_TICK_LEASE_NAME, heldUntil, heldBy: holder })
    .onConflictDoUpdate({
      target: cronLeases.name,
      set: { heldUntil, heldBy: holder, updatedAt: now },
      // UPDATE only matches when the current lease is free or expired.
      // Postgres `ON CONFLICT DO UPDATE ... WHERE` with a non-matching
      // WHERE leaves the row untouched and omits it from RETURNING, so
      // `result.length === 0` is the exact "held by someone else" signal.
      setWhere: sql`${cronLeases.heldUntil} IS NULL OR ${cronLeases.heldUntil} < ${now.toISOString()}::timestamptz`,
    })
    .returning({ heldBy: cronLeases.heldBy });

  return result.length > 0;
}

async function releaseCronTickLease(holder: string): Promise<void> {
  await db
    .update(cronLeases)
    .set({ heldUntil: null, heldBy: null })
    .where(and(eq(cronLeases.name, CRON_TICK_LEASE_NAME), eq(cronLeases.heldBy, holder)));
}

// POST /internal/cron/tick
// 1. Expire pending lessons whose expires_at < now().
// 2. Auto-complete approved lessons that have finished.
internalRouter.post(
  "/cron/tick",
  requireCronSecret,
  validate({}),
  asyncHandler(async (req, res) => {
    // Single-writer gate. Two overlapping ticks (Railway rolling deploy,
    // overlapping manual runs, cron drift): one acquires the lease and
    // runs; the other returns 200 { skipped: true } without touching the
    // DB. An expired lease is taken over automatically (holder crashed).
    const holder = req.requestId;
    const acquired = await tryAcquireCronTickLease(holder);
    if (!acquired) {
      req.log.info({}, "cron/tick skipped: lease already held");
      res.status(200).json({ skipped: true });
      return;
    }

    let body: Record<string, number>;
    try {
      body = await runCronTick(req);
    } finally {
      try {
        await releaseCronTickLease(holder);
      } catch (err) {
        req.log.error(
          { err: err instanceof Error ? err.message : String(err) },
          "cron/tick lease release failed",
        );
      }
    }
    res.json(body);
  }),
);

async function runCronTick(
  req: import("express").Request,
): Promise<Record<string, number>> {
    const now = new Date();

    const { expired, completed, expiredEmailOutboxIds } = await db.transaction(async (tx) => {
      // Pass 1: expire pending lessons past their deadline.
      const expiredRows = await tx
        .update(lessons)
        .set({ status: "expired" })
        .where(
          and(
            eq(lessons.status, "pending"),
            lt(lessons.expiresAt, now),
          ),
        )
        .returning({ id: lessons.id });

      // Parent booking email outbox write (ADR 028): same transaction as
      // the expiry UPDATE so an email can never be lost between commit and
      // scheduling. The sender's supersede guard will drop any stragglers
      // if the lesson's starts_at has already passed by send time.
      const emailOutboxIds: string[] = [];
      for (const row of expiredRows) {
        emailOutboxIds.push(
          await enqueueLessonEmail(tx, {
            lessonId: row.id,
            event: "request_expired",
            actorRole: "system",
          }),
        );
      }

      // Pass 2: auto-complete approved lessons whose end time has passed.
      const completedRows = await tx
        .update(lessons)
        .set({ status: "completed", completedAt: now })
        .where(
          and(
            eq(lessons.status, "approved"),
            sql`(${lessons.startsAt} + (${lessons.durationMinutes} * interval '1 minute')) < ${now.toISOString()}`,
          ),
        )
        .returning({ id: lessons.id });

      // No outbox row for auto-complete — parents don't get a "lesson
      // completed" email in v1 (out of scope per docs/plans/parent-booking-emails.md).

      return { expired: expiredRows, completed: completedRows, expiredEmailOutboxIds: emailOutboxIds };
    });

    // Stubs: notifications (PR 7) and charges (PR 8).
    for (const row of completed) {
      chargeLessonComplete(row.id);
    }

    // Reconcile Google Calendar for every lesson whose status just changed.
    // Expired pending lessons normally have no event (reconcile short-
    // circuits). Completed lessons keep their event under the new rule
    // (approved + completed = event exists) and the reconcile just
    // confirms the state. Microtasks run after the response, independent
    // of the HTTP request lifecycle.
    for (const row of expired) {
      queueMicrotask(() => { void syncLessonToGoogle(row.id); });
    }
    for (const row of completed) {
      queueMicrotask(() => { void syncLessonToGoogle(row.id); });
    }
    // Fire-and-forget parent-email sends for freshly expired lessons.
    // Any that fail or get superseded land in the outbox drain on the
    // next tick (phase 1 item 6).
    for (const outboxId of expiredEmailOutboxIds) {
      queueMicrotask(() => { void sendLessonEmailOutboxRow(outboxId); });
    }

    // Schedule a batch sync pass for every active coach integration. The
    // tick always runs the cheap light pass (drains transient failures);
    // once per 24 hours, promote to a full pass to catch drift. Fire in
    // background so the cron response returns promptly.
    const integrations = await db
      .select({
        coachProfileId: coachCalendarIntegrations.coachProfileId,
        lastFullReconcileAt: coachCalendarIntegrations.lastFullReconcileAt,
      })
      .from(coachCalendarIntegrations)
      .where(eq(coachCalendarIntegrations.status, "active"));
    const nowMs = now.getTime();
    let fullPasses = 0;
    let lightPasses = 0;
    for (const row of integrations) {
      const needsFullPass =
        !row.lastFullReconcileAt ||
        nowMs - row.lastFullReconcileAt.getTime() > FULL_PASS_INTERVAL_MS;
      if (needsFullPass) {
        fullPasses++;
        queueMicrotask(() => { void runFullSyncPass(row.coachProfileId); });
      } else {
        lightPasses++;
        queueMicrotask(() => { void runLightSyncPass(row.coachProfileId); });
      }
    }

    // Parent booking email outbox drain + retention (ADR 028). The drain
    // picks up any pending / failed / expired-claim rows and finalizes
    // them sequentially. The scrub pass nulls payload on terminal rows
    // older than 30 days, preserving the structured status/timestamps for
    // audit while releasing swimmer names and addresses. Both are capped
    // internally so they fit in a cron tick.
    let emailDrainResult = { drained: 0, abandoned: 0 };
    let emailScrubResult = { scrubbed: 0 };
    try {
      emailDrainResult = await drainLessonEmailOutbox();
    } catch (err) {
      // Never log err.message directly — Resend / Node fetch messages
      // can echo recipient email addresses. safeCleanupErrSummary
      // reduces to { name, code, status } only.
      req.log.error(
        { err: safeCleanupErrSummary(err) },
        "cron/tick email drain failed",
      );
    }
    try {
      emailScrubResult = await scrubLessonEmailPayloads();
    } catch (err) {
      req.log.error(
        { err: safeCleanupErrSummary(err) },
        "cron/tick email scrub failed",
      );
    }

    // Coach push notifications (ADR 031): four new passes, all bounded,
    // all idempotent. Each pass has its own try/catch so one failure can't
    // starve the others.
    let coachReleaseResult = { releasedToPending: 0, releasedToSummarized: 0 };
    let coachExpiringResult = { enqueued: 0 };
    let coachDailySummaryResult = { inserted: 0 };
    let coachDrainResult = { drained: 0, abandoned: 0 };
    let coachScrubResult = { scrubbed: 0, deadSubscriptionsPurged: 0 };
    try {
      coachReleaseResult = await releaseHeldCoachNotifications();
    } catch (err) {
      req.log.error(
        { err: err instanceof Error ? err.message : String(err) },
        "cron/tick coach release-held failed",
      );
    }
    try {
      coachExpiringResult = await enqueueExpiringRequestReminders();
    } catch (err) {
      req.log.error(
        { err: err instanceof Error ? err.message : String(err) },
        "cron/tick coach expiring-reminder failed",
      );
    }
    try {
      coachDailySummaryResult = await composeDailyCoachSummary();
    } catch (err) {
      req.log.error(
        { err: err instanceof Error ? err.message : String(err) },
        "cron/tick coach daily-summary failed",
      );
    }
    try {
      coachDrainResult = await drainCoachNotifications();
    } catch (err) {
      req.log.error(
        { err: err instanceof Error ? err.message : String(err) },
        "cron/tick coach push drain failed",
      );
    }
    try {
      coachScrubResult = await scrubCoachNotificationPayloads();
    } catch (err) {
      req.log.error(
        { err: err instanceof Error ? err.message : String(err) },
        "cron/tick coach scrub failed",
      );
    }

    // Account-deletion retry drain (ADR 034 Phase 3). Shares the cron
    // tick lease — no new scheduler. Picks pending jobs whose attempts
    // < MAX and whose updated_at is older than the retry wait floor,
    // replays the external cleanup (calendar reconcile + auth user
    // delete), increments attempts. Terminal 'failed' when retries are
    // exhausted; logs event=account_deletion_cleanup_failed at that
    // point for log-based alerting.
    let accountDeletionRetryResult = { attempted: 0, succeeded: 0, paused: 0, failedTerminal: 0 };
    try {
      accountDeletionRetryResult = await runAccountDeletionRetryDrain(req.log);
    } catch (err) {
      // Never log err.message directly — Supabase Admin SDK errors can
      // echo the user's email in .message and Google Calendar errors
      // can embed swimmer names from event titles. safeCleanupErrSummary
      // reduces to { name, code, status } only.
      req.log.error(
        { err: safeCleanupErrSummary(err) },
        "cron/tick account-deletion retry drain failed",
      );
    }

    req.log.info(
      {
        expiredCount: expired.length,
        completedCount: completed.length,
        fullPasses,
        lightPasses,
        emailDrained: emailDrainResult.drained,
        emailAbandoned: emailDrainResult.abandoned,
        emailScrubbed: emailScrubResult.scrubbed,
        coachReleasedPending: coachReleaseResult.releasedToPending,
        coachReleasedSummarized: coachReleaseResult.releasedToSummarized,
        coachExpiringEnqueued: coachExpiringResult.enqueued,
        coachDailySummaryInserted: coachDailySummaryResult.inserted,
        coachDrained: coachDrainResult.drained,
        coachAbandoned: coachDrainResult.abandoned,
        coachScrubbed: coachScrubResult.scrubbed,
        coachDeadSubsPurged: coachScrubResult.deadSubscriptionsPurged,
        accountDeletionRetryAttempted: accountDeletionRetryResult.attempted,
        accountDeletionRetrySucceeded: accountDeletionRetryResult.succeeded,
        accountDeletionRetryPaused: accountDeletionRetryResult.paused,
        accountDeletionRetryFailedTerminal: accountDeletionRetryResult.failedTerminal,
      },
      "cron/tick",
    );

    return {
      expired: expired.length,
      completed: completed.length,
      fullPasses,
      lightPasses,
      emailDrained: emailDrainResult.drained,
      emailAbandoned: emailDrainResult.abandoned,
      emailScrubbed: emailScrubResult.scrubbed,
      coachReleasedPending: coachReleaseResult.releasedToPending,
      coachReleasedSummarized: coachReleaseResult.releasedToSummarized,
      coachExpiringEnqueued: coachExpiringResult.enqueued,
      coachDailySummaryInserted: coachDailySummaryResult.inserted,
      coachDrained: coachDrainResult.drained,
      coachAbandoned: coachDrainResult.abandoned,
      coachScrubbed: coachScrubResult.scrubbed,
      coachDeadSubsPurged: coachScrubResult.deadSubscriptionsPurged,
      accountDeletionRetryAttempted: accountDeletionRetryResult.attempted,
      accountDeletionRetrySucceeded: accountDeletionRetryResult.succeeded,
      accountDeletionRetryPaused: accountDeletionRetryResult.paused,
      accountDeletionRetryFailedTerminal: accountDeletionRetryResult.failedTerminal,
    };
}
