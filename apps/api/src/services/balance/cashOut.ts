// Cash-out refund engine (ADR 036 Phase 8 Part B).
//
// `executeCashOut` is the service Stop 2 (the coach "Refund leftover
// balance" endpoint + account-deletion hook) will call. It opens one
// transaction, acquires the household-balance advisory lock, computes
// the refund-vs-write-off split, writes the cash_refund + balance_
// writeoff ledger rows + their drain jobs, and returns. No Stripe
// call runs inside the transaction — the drain picks up the job rows
// post-commit (or on the next cron tick) and issues the refunds there
// with idempotency.

import { inArray, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { randomUUID } from "node:crypto";

import { db } from "../../db/client";
import * as schema from "../../db/schema";
import { cashRefundJobs } from "../../db/schema";
import type { CashOutBreakdown } from "@swim-app/shared";
import { getEnv } from "../../lib/env";
import { enqueueBalanceCashedOutEmail } from "../emails/balanceCashedOutOutbox";
import { applyLedgerEntry, withBalanceLock } from "./ledger";
import { INITIAL_POST_COMMIT_DELAY_SECONDS } from "./cashRefundDrain";

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Pure math. Given the four input sums, returns how much goes back to
 * the card and how much becomes a write-off. Clamps so neither value
 * can be negative, and the sum of the two never exceeds the current
 * balance.
 */
export function computeCashOut(args: {
  totalCardPaidCents: number;
  totalCashRefundedCents: number;
  netLessonSpendingCents: number;
  currentBalanceCents: number;
}): { refundableCents: number; writeOffCents: number } {
  const refundableRaw =
    args.totalCardPaidCents
    - args.totalCashRefundedCents
    - args.netLessonSpendingCents;
  const refundable = Math.max(
    0,
    Math.min(refundableRaw, args.currentBalanceCents),
  );
  const writeOff = Math.max(0, args.currentBalanceCents - refundable);
  return { refundableCents: refundable, writeOffCents: writeOff };
}

/**
 * Roll up the four sums the cash-out rule needs, in one SELECT, for a
 * given household. Returns the full breakdown plus the derived refund
 * / write-off split.
 */
export async function getCashOutBreakdown(
  householdId: string,
  dbOrTx: Db = db,
): Promise<CashOutBreakdown> {
  const rows = await dbOrTx.execute<{
    paid: string;
    cash_refunded: string;
    net_lesson: string;
    balance: string;
  }>(sql`
    SELECT
      COALESCE(SUM(amount_cents) FILTER (WHERE entry_type::text IN ('card_topup', 'package_purchase')), 0) AS paid,
      COALESCE(-SUM(amount_cents) FILTER (WHERE entry_type::text = 'cash_refund'), 0) AS cash_refunded,
      COALESCE(-SUM(amount_cents) FILTER (WHERE entry_type::text IN ('lesson_charge', 'refund_to_balance')), 0) AS net_lesson,
      COALESCE(SUM(amount_cents), 0) AS balance
    FROM household_balance_ledger
    WHERE household_id = ${householdId}
  `);
  const row = rows[0] ?? {
    paid: "0",
    cash_refunded: "0",
    net_lesson: "0",
    balance: "0",
  };
  const totalCardPaidCents = Number(row.paid);
  const totalCashRefundedCents = Number(row.cash_refunded);
  const netLessonSpendingCents = Number(row.net_lesson);
  const currentBalanceCents = Number(row.balance);
  const { refundableCents, writeOffCents } = computeCashOut({
    totalCardPaidCents,
    totalCashRefundedCents,
    netLessonSpendingCents,
    currentBalanceCents,
  });
  return {
    totalCardPaidCents,
    totalCashRefundedCents,
    netLessonSpendingCents,
    currentBalanceCents,
    refundableCents,
    writeOffCents,
  };
}

interface PaymentRemaining {
  ledgerId: string;
  stripeCheckoutSessionId: string;
  stripePaymentIntentId: string | null;
  originalAmountCents: number; // positive
  alreadyRefundedCents: number; // positive
  remainingCents: number; // positive
  createdAt: Date;
}

/**
 * Walk the household's `card_topup` + `package_purchase` rows (real
 * card paid, not package bonuses) newest-first. For each, subtract the
 * sum of `cash_refund` rows pointing back at it so we only allocate
 * against money the family hasn't already been refunded.
 */
async function loadRefundablePayments(
  tx: Db,
  householdId: string,
): Promise<PaymentRemaining[]> {
  const rows = await tx.execute<{
    id: string;
    stripe_checkout_session_id: string;
    stripe_payment_intent_id: string | null;
    amount_cents: number;
    already_refunded_cents: string;
    created_at: Date;
  }>(sql`
    SELECT
      payment.id,
      payment.stripe_checkout_session_id,
      payment.stripe_payment_intent_id,
      payment.amount_cents,
      COALESCE(-SUM(refund.amount_cents), 0) AS already_refunded_cents,
      payment.created_at
    FROM household_balance_ledger payment
    LEFT JOIN household_balance_ledger refund
      ON refund.refund_of_ledger_id = payment.id
      AND refund.entry_type::text = 'cash_refund'
    WHERE payment.household_id = ${householdId}
      AND payment.entry_type::text IN ('card_topup', 'package_purchase')
    GROUP BY payment.id, payment.stripe_checkout_session_id, payment.stripe_payment_intent_id, payment.amount_cents, payment.created_at
    ORDER BY payment.created_at DESC
  `);
  return rows.map((row) => {
    const alreadyRefunded = Number(row.already_refunded_cents);
    const remaining = row.amount_cents - alreadyRefunded;
    return {
      ledgerId: row.id,
      stripeCheckoutSessionId: row.stripe_checkout_session_id,
      stripePaymentIntentId: row.stripe_payment_intent_id,
      originalAmountCents: row.amount_cents,
      alreadyRefundedCents: alreadyRefunded,
      remainingCents: remaining,
      createdAt: row.created_at,
    };
  });
}

export interface ExecuteCashOutResult {
  breakdown: CashOutBreakdown;
  cashRefundLedgerIds: string[];
  writeOffLedgerId: string | null;
  cashRefundJobIds: string[];
  // Id of the `balance_cashed_out` outbox row enqueued inside the same
  // transaction. Null when the cash-out was a no-op (zero balance,
  // nothing to refund or write off) or the household has no owner /
  // manager recipients to email.
  emailOutboxId: string | null;
  // Residual that couldn't be allocated to any live card payment
  // (e.g. all the family's top-ups had a null payment_intent_id —
  // pre-ADR-036 rows, test fixtures, or a card that no longer exists).
  // Folded into the write-off row so the balance zeroes, but reported
  // to the caller so Jason knows he must refund that amount off
  // platform.
  needsManualHandlingCents: number;
}

/**
 * Open a transaction, acquire the household-balance advisory lock,
 * compute the breakdown, write the cash_refund / balance_writeoff
 * rows and their jobs, and return. All DB writes are in one tx; Stripe
 * calls run post-commit via the drain.
 *
 * Caller is responsible for kicking the drain (e.g. microtask) after
 * this function returns.
 */
export async function executeCashOut(args: {
  householdId: string;
  actorId: string;
}): Promise<ExecuteCashOutResult> {
  return withBalanceLock(args.householdId, async (tx) => {
    const breakdown = await getCashOutBreakdown(args.householdId, tx);
    if (breakdown.refundableCents === 0 && breakdown.writeOffCents === 0) {
      return {
        breakdown,
        cashRefundLedgerIds: [],
        writeOffLedgerId: null,
        cashRefundJobIds: [],
        emailOutboxId: null,
        needsManualHandlingCents: 0,
      };
    }

    // Allocate the refundable total across available payments
    // newest-first. Payments with a null payment-intent id are
    // skipped — we can't call Stripe without one. Allocation uses
    // pure math on the remaining totals so no Stripe call happens
    // inside the transaction.
    const payments = await loadRefundablePayments(tx, args.householdId);
    let remaining = breakdown.refundableCents;
    const allocations: Array<{
      payment: PaymentRemaining;
      amountCents: number;
    }> = [];
    for (const payment of payments) {
      if (remaining <= 0) break;
      if (payment.remainingCents <= 0) continue;
      if (payment.stripePaymentIntentId === null) continue;
      const take = Math.min(remaining, payment.remainingCents);
      allocations.push({ payment, amountCents: take });
      remaining -= take;
    }
    const needsManualHandlingCents = Math.max(0, remaining);

    const cashRefundLedgerIds: string[] = [];
    const cashRefundJobIds: string[] = [];

    for (const alloc of allocations) {
      // Narrow: allocations only include payments with a non-null
      // payment_intent_id (filter above).
      const paymentIntentId = alloc.payment.stripePaymentIntentId;
      if (paymentIntentId === null) continue;
      const ledgerId = await applyLedgerEntry(tx, {
        entryType: "cash_refund",
        householdId: args.householdId,
        actorId: args.actorId,
        amountCents: -alloc.amountCents,
        stripeCheckoutSessionId: alloc.payment.stripeCheckoutSessionId,
        stripePaymentIntentId: paymentIntentId,
        refundOfLedgerId: alloc.payment.ledgerId,
      });
      cashRefundLedgerIds.push(ledgerId);
      const jobRows = await tx
        .insert(cashRefundJobs)
        .values({
          ledgerId,
          householdId: args.householdId,
          stripePaymentIntentId: paymentIntentId,
          idempotencyKey: randomUUID(),
          amountCents: alloc.amountCents,
        })
        .returning({ id: cashRefundJobs.id });
      const jobId = jobRows[0]?.id;
      if (!jobId) {
        throw new Error(
          "executeCashOut: cash_refund_jobs insert returned no row",
        );
      }
      cashRefundJobIds.push(jobId);
    }

    // The write-off is the gap between the family's current balance
    // and what we can refund to card. Anything that remains after the
    // refundable allocation (unused bonus, coach gifts, or residual
    // payments-older-than-180-days amounts that couldn't be allocated)
    // is written off here so the balance zeroes.
    let writeOffLedgerId: string | null = null;
    const writeOffTotal = breakdown.writeOffCents + needsManualHandlingCents;
    if (writeOffTotal > 0) {
      writeOffLedgerId = await applyLedgerEntry(tx, {
        entryType: "balance_writeoff",
        householdId: args.householdId,
        actorId: args.actorId,
        amountCents: -writeOffTotal,
      });
    }

    // Seed `next_attempt_at` on the fresh jobs so a concurrent cron
    // tick firing between the INSERT above and the post-commit kick
    // can't claim the row before the kick fires (same posture as the
    // account-deletion flow). Overwrites the row's `now()` default.
    // postgres-js serializes JS arrays into Postgres `=`/`IN` lists
    // correctly via drizzle's `inArray`, but a bare ANY($1::uuid[])
    // passes the array stringified as "uuid" which Postgres rejects
    // as a malformed array literal. Use `inArray` instead.
    if (cashRefundJobIds.length > 0) {
      await tx
        .update(cashRefundJobs)
        .set({
          nextAttemptAt: sql`now() + make_interval(secs => ${INITIAL_POST_COMMIT_DELAY_SECONDS})`,
        })
        .where(inArray(cashRefundJobs.id, cashRefundJobIds));
    }

    // Enqueue the parent `balance_cashed_out` email in the same
    // transaction so the family receipt lands with the ledger rows or
    // not at all. Prior cash-refund total excludes the rows this
    // cash-out just wrote (so a family that was never partially
    // refunded sees "$0 previously refunded").
    const emailOutboxId = await enqueueBalanceCashedOutEmail(tx, {
      householdId: args.householdId,
      totalCardPaidCents: breakdown.totalCardPaidCents,
      totalCashRefundedPriorCents: breakdown.totalCashRefundedCents,
      netLessonSpendingCents: breakdown.netLessonSpendingCents,
      refundableCents: breakdown.refundableCents,
      writeOffCents: breakdown.writeOffCents + needsManualHandlingCents,
      siteUrl: getEnv().siteUrl,
    });

    return {
      breakdown,
      cashRefundLedgerIds,
      writeOffLedgerId,
      cashRefundJobIds,
      emailOutboxId,
      needsManualHandlingCents,
    };
  });
}
