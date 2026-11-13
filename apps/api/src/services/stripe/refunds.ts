// Stripe refund wrapper (ADR 036 Phase 8 Part B).
//
// One call per cash_refund_jobs row. The idempotency key comes from
// the job row so a retry after a network blip can't double-refund.
// Errors are classified as retryable (network, 5xx, rate-limit) or
// terminal (charge_already_refunded, outside refund window, disputed).

import type Stripe from "stripe";

import { getStripe } from "./client";

export interface CreateRefundInput {
  paymentIntentId: string;
  amountCents: number;
  idempotencyKey: string;
}

export interface CreateRefundSuccess {
  ok: true;
  stripeRefundId: string;
}

export interface CreateRefundFailure {
  ok: false;
  retryable: boolean;
  reason: string;
}

export type CreateRefundResult = CreateRefundSuccess | CreateRefundFailure;

// Stripe error codes that mean "do not retry" — the state on Stripe's
// side will not change by waiting. The job moves to needs_manual_handling.
const TERMINAL_CODES = new Set<string>([
  "charge_already_refunded",
  "charge_disputed",
  // older than 180 days — Stripe permanently refuses the refund
  "charge_expired_for_refund",
]);

export async function createCashRefund(
  input: CreateRefundInput,
): Promise<CreateRefundResult> {
  const stripe = getStripe();
  try {
    const refund = await stripe.refunds.create(
      {
        payment_intent: input.paymentIntentId,
        amount: input.amountCents,
      },
      { idempotencyKey: input.idempotencyKey },
    );
    return { ok: true, stripeRefundId: refund.id };
  } catch (err) {
    const stripeErr = err as Stripe.errors.StripeError | undefined;
    const code = typeof stripeErr?.code === "string" ? stripeErr.code : null;
    const type = typeof stripeErr?.type === "string" ? stripeErr.type : null;
    const reason = `${type ?? "unknown"}:${code ?? "unknown"}`;
    if (code !== null && TERMINAL_CODES.has(code)) {
      return { ok: false, retryable: false, reason };
    }
    // StripeConnectionError, StripeAPIError (5xx), StripeRateLimitError →
    // retryable. Everything else we haven't categorized defaults to
    // retryable too, so the drain can expend its attempts budget and
    // only land in needs_manual_handling after a real series of
    // failures.
    return { ok: false, retryable: true, reason };
  }
}
