// Retry drain for account_deletion_jobs (ADR 034 Phase 3).
//
// Runs inside the existing /internal/cron/tick handler under the shared
// cron lease — not a new cron service. Each pass picks a bounded batch
// of pending jobs that haven't exhausted their attempts budget, replays
// the external cleanup (calendar reconcile + auth user delete) through
// the shared runAccountDeletionCleanup helper, and increments attempts
// via `sql\`attempts + 1\`` so overlapping ticks or an in-flight route
// fan-out can't silently overwrite each other's counter.
//
// Terminal state: a job whose attempts (after this pass's increment)
// has reached MAX_ATTEMPTS AND whose cleanup still failed is flipped
// to status='failed' and logged at error level with ids only. No coach
// notification — per ADR 034, Jason can't fix a Supabase or Google
// outage from the alerts page, so routing it through log-based
// alerting instead of in-app noise is the deliberate choice.

import type { Logger } from "pino";
import { and, eq, lt, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { accountDeletionJobs } from "../../db/schema";
import {
  runAccountDeletionCleanup,
  type AccountDeletionCleanupDeps,
} from "./cleanup";

// Soft ceiling on attempts. 10 matches the email outbox retry budget
// (ADR 028) and the number proposed in docs/plans/account-deletion.md.
// A job is picked for retry only when attempts < this.
export const ACCOUNT_DELETION_MAX_ATTEMPTS = 10;

// Max jobs processed per cron tick. The drain is single-writer (shares
// the cron tick lease) and each pass runs cleanup serially, so this is
// a latency-vs-budget knob rather than a concurrency control. 20 keeps
// a worst-case retry burst inside the tick budget.
const DRAIN_BATCH_SIZE = 20;

// Floor on time-since-last-update before a job is eligible for retry.
// The route's own post-commit fan-out updated_at was just now; waiting
// a minute spreads the cadence out so a transient Supabase/Google blip
// isn't hammered within the same second.
const MIN_RETRY_WAIT_SECONDS = 60;

export interface AccountDeletionRetryDrainResult {
  attempted: number;
  succeeded: number;
  failedTerminal: number;
}

export async function runAccountDeletionRetryDrain(
  log: Logger,
  deps: AccountDeletionCleanupDeps = {},
): Promise<AccountDeletionRetryDrainResult> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - MIN_RETRY_WAIT_SECONDS * 1000);

  // Lock the eligible rows up front so two ticks can't double-process
  // the same job if the cron lease ever falls through (expired lease
  // takeover + a slow prior tick overlapping). FOR UPDATE SKIP LOCKED
  // gives each caller a disjoint set; a second concurrent run just
  // sees an empty batch and returns cleanly.
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
        lt(accountDeletionJobs.updatedAt, cutoff),
      ),
    )
    .orderBy(accountDeletionJobs.updatedAt)
    .limit(DRAIN_BATCH_SIZE)
    .for("update", { skipLocked: true });

  if (eligible.length === 0) {
    return { attempted: 0, succeeded: 0, failedTerminal: 0 };
  }

  let succeeded = 0;
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
        .set({ status: "completed", completedAt: new Date(), lastError: null })
        .where(eq(accountDeletionJobs.id, job.id));
      succeeded++;
      continue;
    }

    // Still failing. Decide between pending (more retries available)
    // and failed terminal (budget exhausted after this attempt).
    const nextAttempts = job.attempts + 1;
    if (nextAttempts >= ACCOUNT_DELETION_MAX_ATTEMPTS) {
      await db
        .update(accountDeletionJobs)
        .set({
          status: "failed",
          attempts: sql`${accountDeletionJobs.attempts} + 1`,
          lastError: result.lastError,
        })
        .where(eq(accountDeletionJobs.id, job.id));
      // Terminal: log loudly so log-based alerting can route it. Ids
      // only — scope is a short enum, attempts is an int. Nothing
      // derived from the user's email, name, or payload fields.
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
      await db
        .update(accountDeletionJobs)
        .set({
          attempts: sql`${accountDeletionJobs.attempts} + 1`,
          lastError: result.lastError,
        })
        .where(eq(accountDeletionJobs.id, job.id));
    }
  }

  return {
    attempted: eligible.length,
    succeeded,
    failedTerminal,
  };
}

/** Exposed for tests that want to stub the row fetch without a real DB. */
export const __test = { MIN_RETRY_WAIT_SECONDS, DRAIN_BATCH_SIZE };
