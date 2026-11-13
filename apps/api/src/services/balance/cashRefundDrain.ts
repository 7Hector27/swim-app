// Retry drain for cash_refund_jobs (ADR 036 Phase 8 Part B).
//
// Shares the /internal/cron/tick lease — not a new scheduler.
// Each pass claims a bounded batch of pending jobs whose
// next_attempt_at <= now() and attempts < MAX, calls Stripe's refund
// API with the job's idempotency key (so a retry after a network blip
// never double-refunds), and advances per-row state:
//
//   - ok → status='succeeded', stripe_refund_id, succeeded_at set,
//     next_attempt_at cleared.
//   - !ok + retryable → increment attempts via `attempts + 1`, push
//     next_attempt_at by the exponential backoff below, lastError set.
//   - !ok + !retryable OR attempts exhausted → status='needs_manual_
//     handling', lastError set, logs event=
//     cash_refund_needs_manual_handling at `error` level for alerting.

import { sql } from "drizzle-orm";
import type { Logger } from "pino";

import { db } from "../../db/client";
import { getEnv } from "../../lib/env";
import { createCashRefund, type CreateRefundResult } from "../stripe/refunds";
import { enqueueCashRefundNeedsManualNotification } from "./notifications";

// Attempts budget. Shorter than account-deletion's 11 — Stripe refund
// errors that aren't code-level terminal are usually transient
// network. Six attempts span ~4.3h (5+10+20+40+80+160 min) before
// terminal needs_manual_handling.
export const CASH_REFUND_MAX_ATTEMPTS = 6;

// Exponential backoff for retryable errors:
//
//   attempts=1 → 5m    attempts=4 → 40m
//   attempts=2 → 10m   attempts=5 → 80m
//   attempts=3 → 20m   attempts=6 → 160m → capped 3h
const BACKOFF_BASE_SECONDS = 5 * 60;
const BACKOFF_CAP_SECONDS = 3 * 60 * 60;

// Initial `next_attempt_at` seeded by the service when the cash-out
// transaction inserts the job row. The post-commit kick runs within
// milliseconds of commit; this lead window prevents a concurrent cron
// tick firing between INSERT and the post-commit kick from claiming
// the same row. Mirrors ACCOUNT_DELETION_INITIAL_DELAY_SECONDS.
export const INITIAL_POST_COMMIT_DELAY_SECONDS = 2 * 60;

// Claim lease: when the drain picks up a row, it atomically pushes
// next_attempt_at into the future by this amount BEFORE processing.
// Defense-in-depth against the cron-lease ever expiring mid-tick. The
// loop overwrites with the real backoff / terminal value when
// processing finishes.
const CLAIM_LEASE_SECONDS = 60;

// Max jobs processed per cron tick. Single-writer (shares the cron
// tick lease); latency-vs-budget knob rather than concurrency control.
const DRAIN_BATCH_SIZE = 20;

/**
 * Backoff for the Nth retryable failure. Caller passes the attempts
 * value the row will have AFTER incrementing (the value the drain is
 * about to write). Returns delay in seconds.
 */
export function computeCashRefundBackoffSeconds(
  attemptsAfterIncrement: number,
): number {
  const effective = Math.max(1, attemptsAfterIncrement);
  const doubled = BACKOFF_BASE_SECONDS * Math.pow(2, effective - 1);
  const bounded = Math.min(doubled, BACKOFF_CAP_SECONDS);
  if (!Number.isFinite(bounded)) return BACKOFF_CAP_SECONDS;
  return Math.floor(bounded);
}

export interface CashRefundRetryDrainResult {
  attempted: number;
  succeeded: number;
  // Present for parity with account-deletion's drain shape; cash-refund
  // doesn't have a "paused" branch (no Jason-reconnect scenario), so
  // always 0.
  paused: 0;
  failedTerminal: number;
  needsManualHandling: number;
}

export interface CashRefundDrainDeps {
  // Injectable for tests so no real Stripe call is made.
  createRefund?: (args: {
    paymentIntentId: string;
    amountCents: number;
    idempotencyKey: string;
  }) => Promise<CreateRefundResult>;
  // When present, claim only these specific job ids and skip the
  // normal `next_attempt_at <= now()` eligibility filter. Used by the
  // post-commit kick (`kickCashRefundDrain`) so the just-written jobs
  // process immediately, before the 2-minute cron-tick lead window
  // on their `next_attempt_at` would otherwise block them. The claim
  // still takes FOR UPDATE SKIP LOCKED and still checks status and
  // attempts, so a job already being processed by the cron tick is
  // safely skipped.
  onlyJobIds?: string[];
}

export async function runCashRefundRetryDrain(
  log: Logger,
  deps: CashRefundDrainDeps = {},
): Promise<CashRefundRetryDrainResult> {
  const createRefundFn = deps.createRefund ?? createCashRefund;

  const useOnlyJobIds = deps.onlyJobIds !== undefined;
  if (useOnlyJobIds && deps.onlyJobIds!.length === 0) {
    // Caller explicitly passed an empty list: there's nothing to do
    // and we don't want to fall through to the full eligibility scan.
    return {
      attempted: 0,
      succeeded: 0,
      paused: 0,
      failedTerminal: 0,
      needsManualHandling: 0,
    };
  }

  // Atomic claim: single UPDATE statement that pushes next_attempt_at
  // into the future on every row the drain is about to process. The
  // inner SELECT uses FOR UPDATE SKIP LOCKED so two concurrent drain
  // passes against the same eligible set get disjoint rows.
  //
  // Two selection modes:
  //  - Default (cron tick): rows where next_attempt_at <= now().
  //  - onlyJobIds (post-commit kick): the specific ids the caller just
  //    inserted, bypassing the time-based filter so Stripe is called
  //    immediately. The `status='pending'` and `attempts<MAX` and
  //    `stripe_payment_intent_id IS NOT NULL` guards still apply.
  // Postgres array binding via postgres-js ignores a bare JS array in
  // `ANY($1::uuid[])` (serializes to `uuid` which the server rejects
  // as a malformed array literal; the same footnote is in cashOut.ts).
  // Expand the id list as `IN (uuid, uuid, ...)` with `sql.join` so
  // each id is bound individually.
  const eligibilityClause = useOnlyJobIds
    ? sql`id IN (${sql.join(
        deps.onlyJobIds!.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`
    : sql`next_attempt_at <= now()`;

  const claimed = await db.execute<{
    id: string;
    ledger_id: string;
    household_id: string | null;
    stripe_payment_intent_id: string;
    idempotency_key: string;
    amount_cents: number;
    attempts: number;
  }>(sql`
    UPDATE cash_refund_jobs
    SET next_attempt_at = now() + make_interval(secs => ${CLAIM_LEASE_SECONDS}),
        last_attempt_at = now(),
        claimed_until = now() + make_interval(secs => ${CLAIM_LEASE_SECONDS})
    WHERE id IN (
      SELECT id FROM cash_refund_jobs
      WHERE status = 'pending'
        AND attempts < ${CASH_REFUND_MAX_ATTEMPTS}
        AND stripe_payment_intent_id IS NOT NULL
        AND ${eligibilityClause}
      ORDER BY next_attempt_at ASC
      LIMIT ${DRAIN_BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, ledger_id, household_id, stripe_payment_intent_id, idempotency_key, amount_cents, attempts
  `);

  const eligible = claimed.map((row) => ({
    id: row.id,
    ledgerId: row.ledger_id,
    householdId: row.household_id,
    stripePaymentIntentId: row.stripe_payment_intent_id,
    idempotencyKey: row.idempotency_key,
    amountCents: row.amount_cents,
    attempts: row.attempts,
  }));

  if (eligible.length === 0) {
    return {
      attempted: 0,
      succeeded: 0,
      paused: 0,
      failedTerminal: 0,
      needsManualHandling: 0,
    };
  }

  let succeeded = 0;
  let failedTerminal = 0;
  let needsManualHandling = 0;

  for (const job of eligible) {
    const result = await createRefundFn({
      paymentIntentId: job.stripePaymentIntentId,
      amountCents: job.amountCents,
      idempotencyKey: job.idempotencyKey,
    });

    if (result.ok) {
      await db.execute(sql`
        UPDATE cash_refund_jobs
        SET status = 'succeeded',
            succeeded_at = now(),
            stripe_refund_id = ${result.stripeRefundId},
            last_error = NULL,
            claimed_until = NULL
        WHERE id = ${job.id}
      `);
      succeeded++;
      continue;
    }

    // Retryable error with budget remaining → increment attempts,
    // push next_attempt_at by the backoff.
    const nextAttempts = job.attempts + 1;
    if (result.retryable && nextAttempts < CASH_REFUND_MAX_ATTEMPTS) {
      const backoffSeconds = computeCashRefundBackoffSeconds(nextAttempts);
      await db.execute(sql`
        UPDATE cash_refund_jobs
        SET attempts = attempts + 1,
            last_error = ${result.reason},
            next_attempt_at = now() + make_interval(secs => ${backoffSeconds}),
            claimed_until = NULL
        WHERE id = ${job.id}
      `);
      continue;
    }

    // Terminal: either non-retryable or budget exhausted after this
    // increment. Ledger row stays (append-only); we just flag the job
    // for Jason to resolve off-platform. The UPDATE + the coach
    // notification insert run inside one transaction so the bell row
    // and the state transition commit or roll back together — a lone
    // UPDATE without a matching notification would leave the family-
    // page banner feeding off stale data. Log at `error` level so a
    // log-based alert can fire.
    const needsManualReason = `stripe_refund_failed:${result.reason}`;
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE cash_refund_jobs
        SET status = 'needs_manual_handling',
            attempts = attempts + 1,
            last_error = ${result.reason},
            needs_manual_reason = ${needsManualReason},
            next_attempt_at = now(),
            claimed_until = NULL
        WHERE id = ${job.id}
      `);
      await enqueueCashRefundNeedsManualNotification(tx, {
        jobId: job.id,
        householdId: job.householdId,
        amountCents: job.amountCents,
        reason: needsManualReason,
        // Drain row — the job has a payment intent (claim query filters
        // out null ids) that Jason can paste into the Stripe dashboard.
        stripePaymentIntentId: job.stripePaymentIntentId,
        siteUrl: getEnv().siteUrl,
      });
    });
    log.error(
      {
        event: "cash_refund_needs_manual_handling",
        jobId: job.id,
        ledgerId: job.ledgerId,
        attempts: nextAttempts,
        retryable: result.retryable,
        reason: result.reason,
      },
      "cash refund needs manual handling",
    );
    if (result.retryable) {
      // Budget exhausted on a retryable error.
      failedTerminal++;
    } else {
      needsManualHandling++;
    }
  }

  return {
    attempted: eligible.length,
    succeeded,
    paused: 0,
    failedTerminal,
    needsManualHandling,
  };
}

/**
 * Post-commit kick. Caller awaits the main transaction, then schedules
 * this microtask so the HTTP response returns promptly while Stripe
 * calls run in the background. The drain swallows its own errors into
 * per-row state; a top-level throw is logged but never re-thrown.
 */
export function kickCashRefundDrain(log: Logger, jobIds?: string[]): void {
  // Pass the just-written job ids so the drain bypasses its
  // next_attempt_at eligibility filter for them. Without this, the
  // 2-minute cron-tick lead window on next_attempt_at would delay
  // Stripe refunds by up to 5 minutes (next cron tick) even though
  // the microtask fires immediately after commit.
  const deps = jobIds === undefined ? undefined : { onlyJobIds: jobIds };
  queueMicrotask(() => {
    void runCashRefundRetryDrain(log, deps).catch((err) => {
      log.error(
        { err: err instanceof Error ? err.message : String(err) },
        "kickCashRefundDrain: top-level drain throw",
      );
    });
  });
}
