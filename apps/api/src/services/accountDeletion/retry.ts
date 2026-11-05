// Retry drain for account_deletion_jobs (ADR 034 Phase 3).
//
// Runs inside the existing /internal/cron/tick handler under the shared
// cron lease — not a new cron service. Each pass picks a bounded batch
// of pending jobs that are due (next_attempt_at <= now()) and haven't
// exhausted their attempts budget, replays the external cleanup
// (calendar reconcile + auth user delete) through the shared
// runAccountDeletionCleanup helper, and advances per-row state:
//
//   - allOk → status='completed', next_attempt_at cleared.
//   - paused (calendar step is waiting on Jason to reconnect Google,
//     no other error) → push next_attempt_at by a short recheck
//     window, DO NOT increment attempts. Jason's weekly OAuth
//     reconnect window must not burn the retry budget.
//   - real error, budget remaining → increment attempts via
//     `sql\`attempts + 1\``, push next_attempt_at by the exponential
//     backoff below.
//   - real error, budget exhausted → status='failed'. Logs error with
//     ids only — no coach notification, per ADR 034 (Jason can't fix
//     an outage from the alerts page; route via log-based alerting).

import type { Logger } from "pino";
import { and, eq, isNull, lte, lt, or, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { accountDeletionJobs } from "../../db/schema";
import {
  runAccountDeletionCleanup,
  type AccountDeletionCleanupDeps,
} from "./cleanup";

// Attempts budget. Coupled with the exponential backoff below, 11
// attempts span ~28.6 hours before terminal 'failed' — long enough to
// ride out a Supabase Auth outage well past "hey ops, is the dashboard
// down?" and the backfill retries after the outage clears.
//
// Why 11 and not the email outbox's 10: the email retry budget assumes
// Resend will come back within an hour. This drain retries two
// services (Google + Supabase Admin) whose outages can last longer;
// we'd rather pay one extra attempt than terminate on a half-day
// upstream incident.
export const ACCOUNT_DELETION_MAX_ATTEMPTS = 11;

// Exponential backoff for real-error retries. Wait after `attempts`
// real failures is `min(base * 2^(attempts-1), cap)`:
//
//   attempts=1 → 5m    attempts=5 →  80m
//   attempts=2 → 10m   attempts=6 → 160m
//   attempts=3 → 20m   attempts=7 → 320m → capped 6h
//   attempts=4 → 40m   attempts=8..10 → 6h
//
// Sum of waits across 10 inter-attempt gaps (10 retries after the
// first) = 5+10+20+40+80+160+320+360+360+360 = 1715 min ≈ 28.6h.
const BACKOFF_BASE_SECONDS = 5 * 60;
const BACKOFF_CAP_SECONDS = 6 * 60 * 60;

// Short recheck window when the calendar step is paused on a
// disconnected Google integration. Matches the cron tick cadence so
// we re-check on the very next tick after Jason reconnects.
const CALENDAR_PAUSED_RECHECK_SECONDS = 5 * 60;

// Default `next_attempt_at` push when the route's post-commit fan-out
// fails on the first try — the drain picks the job up after this
// window. Matches the route's "first attempt" backoff (attempts=1).
export const ROUTE_POST_COMMIT_FAILURE_BACKOFF_SECONDS = BACKOFF_BASE_SECONDS;

// Max jobs processed per cron tick. The drain is single-writer (shares
// the cron tick lease) and each pass runs cleanup serially, so this is
// a latency-vs-budget knob rather than a concurrency control. 20 keeps
// a worst-case retry burst inside the tick budget.
const DRAIN_BATCH_SIZE = 20;

/**
 * Backoff for the Nth real failure. Caller passes the attempts value
 * the row will have AFTER incrementing (the one the drain is about to
 * write). Returns the delay in seconds to push next_attempt_at by.
 */
export function computeAccountDeletionBackoffSeconds(attemptsAfterIncrement: number): number {
  const effective = Math.max(1, attemptsAfterIncrement);
  const doubled = BACKOFF_BASE_SECONDS * Math.pow(2, effective - 1);
  const bounded = Math.min(doubled, BACKOFF_CAP_SECONDS);
  // Guard against overflow for very large exponents even though
  // MAX_ATTEMPTS caps us well below that.
  if (!Number.isFinite(bounded)) return BACKOFF_CAP_SECONDS;
  return Math.floor(bounded);
}

export interface AccountDeletionRetryDrainResult {
  attempted: number;
  succeeded: number;
  paused: number;
  failedTerminal: number;
}

export async function runAccountDeletionRetryDrain(
  log: Logger,
  deps: AccountDeletionCleanupDeps = {},
): Promise<AccountDeletionRetryDrainResult> {
  const now = new Date();

  // Lock the eligible rows up front so two ticks can't double-process
  // the same job if the cron lease ever falls through (expired lease
  // takeover + a slow prior tick overlapping). FOR UPDATE SKIP LOCKED
  // gives each caller a disjoint set; a second concurrent run just
  // sees an empty batch and returns cleanly.
  //
  // next_attempt_at NULL means "immediately eligible" — covers rows
  // created before migration 0071 landed and rows whose route post-
  // commit fan-out succeeded on first try but got updated without a
  // backoff value.
  const eligible = await db
    .select({
      id: accountDeletionJobs.id,
      authUserId: accountDeletionJobs.authUserId,
      scope: accountDeletionJobs.scope,
      anonymizedLessonIds: accountDeletionJobs.anonymizedLessonIds,
      attempts: accountDeletionJobs.attempts,
    })
    .from(accountDeletionJobs)
    .where(
      and(
        eq(accountDeletionJobs.status, "pending"),
        lt(accountDeletionJobs.attempts, ACCOUNT_DELETION_MAX_ATTEMPTS),
        or(
          isNull(accountDeletionJobs.nextAttemptAt),
          lte(accountDeletionJobs.nextAttemptAt, now),
        ),
      ),
    )
    .orderBy(accountDeletionJobs.updatedAt)
    .limit(DRAIN_BATCH_SIZE)
    .for("update", { skipLocked: true });

  if (eligible.length === 0) {
    return { attempted: 0, succeeded: 0, paused: 0, failedTerminal: 0 };
  }

  let succeeded = 0;
  let paused = 0;
  let failedTerminal = 0;

  for (const job of eligible) {
    const result = await runAccountDeletionCleanup(
      {
        id: job.id,
        authUserId: job.authUserId,
        scope: job.scope,
        anonymizedLessonIds: [...job.anonymizedLessonIds],
      },
      log,
      deps,
    );

    if (result.allOk) {
      await db
        .update(accountDeletionJobs)
        .set({
          status: "completed",
          completedAt: new Date(),
          lastError: null,
          nextAttemptAt: null,
        })
        .where(eq(accountDeletionJobs.id, job.id));
      succeeded++;
      continue;
    }

    if (result.paused) {
      // Paused on a disconnected Google integration. No real error, so
      // don't consume an attempt — just push next_attempt_at out by the
      // recheck window and leave attempts alone. The job will pick up
      // again on the next tick after that window; once Jason
      // reconnects, the next pass resolves cleanly.
      const nextAttemptAt = new Date(Date.now() + CALENDAR_PAUSED_RECHECK_SECONDS * 1000);
      await db
        .update(accountDeletionJobs)
        .set({
          lastError: "paused:integration_needs_reconnect",
          nextAttemptAt,
        })
        .where(eq(accountDeletionJobs.id, job.id));
      paused++;
      continue;
    }

    // Real error. Decide between pending (more retries available) and
    // failed terminal (budget exhausted after this increment).
    const nextAttempts = job.attempts + 1;
    if (nextAttempts >= ACCOUNT_DELETION_MAX_ATTEMPTS) {
      await db
        .update(accountDeletionJobs)
        .set({
          status: "failed",
          attempts: sql`${accountDeletionJobs.attempts} + 1`,
          lastError: result.lastError,
          // Terminal rows aren't picked up by the drain again, but
          // clear nextAttemptAt so a diagnostic query filtering on it
          // isn't misled.
          nextAttemptAt: null,
        })
        .where(eq(accountDeletionJobs.id, job.id));
      log.error(
        {
          event: "account_deletion_cleanup_failed",
          jobId: job.id,
          scope: job.scope,
          attempts: nextAttempts,
        },
        "account deletion retries exhausted",
      );
      failedTerminal++;
    } else {
      const backoffSeconds = computeAccountDeletionBackoffSeconds(nextAttempts);
      const nextAttemptAt = new Date(Date.now() + backoffSeconds * 1000);
      await db
        .update(accountDeletionJobs)
        .set({
          attempts: sql`${accountDeletionJobs.attempts} + 1`,
          lastError: result.lastError,
          nextAttemptAt,
        })
        .where(eq(accountDeletionJobs.id, job.id));
    }
  }

  return {
    attempted: eligible.length,
    succeeded,
    paused,
    failedTerminal,
  };
}

/** Exposed for tests that want to stub the row fetch without a real DB. */
export const __test = {
  BACKOFF_BASE_SECONDS,
  BACKOFF_CAP_SECONDS,
  CALENDAR_PAUSED_RECHECK_SECONDS,
  DRAIN_BATCH_SIZE,
};
