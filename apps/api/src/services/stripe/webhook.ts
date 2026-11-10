// Stripe webhook processing (ADR 036 Phase 3).
//
// The webhook is the ONLY path that credits a household's balance. The
// success redirect is cosmetic (`/account/balance?topup=success`) — it
// re-reads balance from the DB and shows a toast, never writes. Every
// defensive check lives here, not at the HTTP boundary, so the shape of
// the ledger stays correct no matter what client called in.
//
// Processing order per event:
//   1. Verify signature on the RAW request body → invalid ⇒ caller 400s.
//   2. Insert into stripe_events (ON CONFLICT DO NOTHING). Zero rows
//      returned ⇒ replay, respond 200 without touching the ledger.
//   3. Dispatch by event type. For v1 only `checkout.session.completed`
//      credits balance; other types record only.
//   4. Re-validate the session metadata against our pricing module and
//      verify the household exists. Any mismatch ⇒ log warn, do NOT
//      credit, still respond 200 so Stripe doesn't retry a policy refusal.
//   5. Under the per-household balance lock, insert the ledger + audit
//      row(s) with ON CONFLICT DO NOTHING on `stripe_checkout_session_id`
//      — the belt-and-suspenders Layer 2 idempotency guard.

import type Stripe from "stripe";
import type { Logger } from "pino";
import { eq, sql } from "drizzle-orm";

import { packagePrice, priceForLesson } from "@swim-app/shared";

import { db } from "../../db/client";
import {
  households,
  householdAuditLog,
  householdBalanceLedger,
  stripeEvents,
} from "../../db/schema";
import { getHouseholdBalance } from "../balance/ledger";
import { enqueueBalanceFundedEmail } from "../emails/balanceFundedOutbox";
import { sendLessonEmailOutboxRow } from "../emails/sender";
import { getStripe } from "./client";
import { CheckoutMetadataSchema, type CheckoutMetadata } from "./metadata";

// Caller hands the raw buffer + signature header; the webhook route does not
// parse JSON before calling us (Stripe's signature covers the bytes exactly).
export interface WebhookInput {
  rawBody: Buffer;
  signature: string | undefined;
  webhookSecret: string;
  logger: Logger;
  // Threaded through so the funds-added email outbox writer (ADR 036
  // Phase 7) can build an absolute CTA link without re-reading env
  // inside the transaction.
  siteUrl: string;
}

export class WebhookSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookSignatureError";
  }
}

// Minimal result surface. The HTTP handler maps `status` straight to the
// response code; the `reason` string is for logging only.
export interface WebhookResult {
  status: 200 | 400;
  reason:
    | "processed"
    | "replay"
    | "ignored_event_type"
    | "metadata_invalid"
    | "amount_mismatch"
    | "household_missing"
    | "payment_not_paid"
    | "already_credited"
    | "signature_invalid";
}

export async function processWebhook(input: WebhookInput): Promise<WebhookResult> {
  let event: Stripe.Event;
  try {
    if (!input.signature) {
      throw new WebhookSignatureError("missing stripe-signature header");
    }
    event = getStripe().webhooks.constructEvent(
      input.rawBody,
      input.signature,
      input.webhookSecret,
    );
  } catch (err) {
    input.logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "stripe webhook signature verification failed",
    );
    return { status: 400, reason: "signature_invalid" };
  }

  // v1 only credits on checkout.session.completed. Other event types are
  // returned 200 with no DB write — Stripe stops retrying once it sees 200.
  if (event.type !== "checkout.session.completed") {
    input.logger.info(
      { eventId: event.id, type: event.type },
      "stripe webhook ignored event type",
    );
    return { status: 200, reason: "ignored_event_type" };
  }

  return handleCheckoutCompleted(event, input.logger, input.siteUrl);
}

async function handleCheckoutCompleted(
  event: Stripe.Event,
  logger: Logger,
  siteUrl: string,
): Promise<WebhookResult> {
  const sessionFromEvent = event.data.object as Stripe.Checkout.Session;

  // Everything that mutates the DB happens inside one transaction so the
  // dedup marker in `stripe_events` lands atomically with the ledger
  // credit. If the credit path fails midway, both roll back and Stripe
  // retries; if it succeeds, both commit and the replay check above will
  // return `replay` next time.
  return db.transaction(async (tx) => {
    const recorded = await tx
      .insert(stripeEvents)
      .values({
        stripeEventId: event.id,
        eventType: event.type,
        stripeCheckoutSessionId: sessionFromEvent.id,
      })
      .onConflictDoNothing({ target: stripeEvents.stripeEventId })
      .returning({ id: stripeEvents.stripeEventId });

    if (recorded.length === 0) {
      logger.info(
        { eventId: event.id, sessionId: sessionFromEvent.id },
        "stripe webhook replay — no credit",
      );
      return { status: 200, reason: "replay" };
    }

    // Retrieve the session from Stripe for authoritative data — the webhook
    // body carries the same values but reading from Stripe eliminates any
    // concern about truncation or trusted-field reshuffling at delivery.
    const session = await getStripe().checkout.sessions.retrieve(
      sessionFromEvent.id,
    );

    // checkout.session.completed fires when the Checkout flow terminates in
    // a success state — Stripe-side success, which for async-funded
    // payment methods (bank debits, some wallets) may still be settling.
    // Credit only when Stripe says the funds are in: payment_status "paid".
    // Any other value (unpaid, no_payment_required) means the money isn't
    // ours and we must not move balance. Stripe resends the event when
    // the payment_status transitions to paid (checkout.session.async_payment_succeeded
    // and a second completed), and our idempotency layers collapse those
    // into a single credit when the time comes.
    if (session.payment_status !== "paid") {
      logger.warn(
        {
          eventId: event.id,
          sessionId: session.id,
          paymentStatus: session.payment_status,
        },
        "stripe webhook payment not paid — no credit",
      );
      await tx
        .update(stripeEvents)
        .set({ processedAt: new Date() })
        .where(eq(stripeEvents.stripeEventId, event.id));
      return { status: 200, reason: "payment_not_paid" };
    }

    const metadataResult = CheckoutMetadataSchema.safeParse(session.metadata);
    if (!metadataResult.success) {
      logger.warn(
        {
          eventId: event.id,
          sessionId: session.id,
          issues: metadataResult.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        "stripe webhook metadata invalid — no credit",
      );
      // Mark processed so we don't retry on replay even though we didn't
      // credit. The stripe_events row stays as an audit breadcrumb.
      await tx
        .update(stripeEvents)
        .set({ processedAt: new Date() })
        .where(eq(stripeEvents.stripeEventId, event.id));
      return { status: 200, reason: "metadata_invalid" };
    }

    const metadata = metadataResult.data;
    const expectedAmount = expectedAmountCents(metadata);
    if (session.amount_total !== expectedAmount) {
      logger.warn(
        {
          eventId: event.id,
          sessionId: session.id,
          expected: expectedAmount,
          actual: session.amount_total,
          kind: metadata.kind,
        },
        "stripe webhook amount mismatch — no credit",
      );
      await tx
        .update(stripeEvents)
        .set({ processedAt: new Date() })
        .where(eq(stripeEvents.stripeEventId, event.id));
      return { status: 200, reason: "amount_mismatch" };
    }

    const householdRows = await tx
      .select({ id: households.id })
      .from(households)
      .where(eq(households.id, metadata.householdId))
      .limit(1);

    if (householdRows.length === 0) {
      logger.warn(
        { eventId: event.id, sessionId: session.id, householdId: metadata.householdId },
        "stripe webhook household missing — no credit",
      );
      await tx
        .update(stripeEvents)
        .set({ processedAt: new Date() })
        .where(eq(stripeEvents.stripeEventId, event.id));
      return { status: 200, reason: "household_missing" };
    }

    // Enter the per-household balance lock before any ledger read-or-write.
    // Mirrors the parent-booking pattern (ADR 036 §1 concurrency) and keeps
    // the credit atomic against concurrent lesson charges for the same
    // household.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${"household-balance:" + metadata.householdId}))`,
    );

    const paymentIntentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id ?? null;

    const creditResult = await writeCredit(tx, {
      metadata,
      sessionId: session.id,
      paymentIntentId,
      expectedAmount,
    });

    await tx
      .update(stripeEvents)
      .set({ processedAt: new Date() })
      .where(eq(stripeEvents.stripeEventId, event.id));

    if (creditResult.kind === "already_credited") {
      logger.warn(
        { eventId: event.id, sessionId: session.id },
        "stripe webhook — ledger row already present for session id (Layer 2 guard fired)",
      );
      return { status: 200, reason: "already_credited" };
    }

    // ADR 036 Phase 7: enqueue the parent-facing "funds added" email
    // inside this same transaction. Post-refund balance is already
    // snapshotted by writeCredit → the family sees the exact number
    // their account showed when the ledger committed.
    const fundedOutboxId = await enqueueBalanceFundedEmail(tx, {
      householdId: metadata.householdId,
      type: metadata.kind === "topup" ? "topup" : "package",
      amountPaidCents: creditResult.amountPaidCents,
      bonusCents: creditResult.bonusCents,
      newBalanceCents: creditResult.newBalanceCents,
      siteUrl,
    });

    logger.info(
      {
        eventId: event.id,
        sessionId: session.id,
        householdId: metadata.householdId,
        kind: metadata.kind,
        amountCents: expectedAmount,
        fundedOutboxId,
      },
      "stripe webhook credited balance",
    );
    // Hand the outbox row to the post-commit sender so it goes out
    // immediately on success. On rollback the row never commits, so
    // the sender has nothing to pick up — the Promise rejects silently
    // via the ambient catch in sendLessonEmailOutboxRow.
    if (fundedOutboxId !== null) {
      queueMicrotask(() => {
        void sendLessonEmailOutboxRow(fundedOutboxId);
      });
    }
    return { status: 200, reason: "processed" };
  });
}

function expectedAmountCents(metadata: CheckoutMetadata): number {
  if (metadata.kind === "topup") {
    return priceForLesson(metadata.durationMinutes, metadata.swimmerCount);
  }
  return packagePrice(metadata.packageTier, metadata.swimmerCount).priceCents;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

interface WriteCreditInput {
  metadata: CheckoutMetadata;
  sessionId: string;
  paymentIntentId: string | null;
  expectedAmount: number;
}

// ADR 036 Phase 7: writeCredit returns the amount paid + bonus + new
// balance so the caller can hand them to the funds-added email outbox
// without re-reading the ledger.
type WriteCreditResult =
  | { kind: "already_credited" }
  | {
      kind: "written";
      amountPaidCents: number;
      bonusCents: number;
      newBalanceCents: number;
    };

async function writeCredit(
  tx: Tx,
  input: WriteCreditInput,
): Promise<WriteCreditResult> {
  // Layer 2 idempotency: the partial UNIQUE index on
  // `balance_ledger_stripe_session_uq` (scoped to card_topup | package_purchase)
  // catches any second credit for the same session that somehow bypasses
  // the stripe_events dedup — misconfigured clone endpoint, DB restore,
  // operational mistake. ON CONFLICT DO NOTHING keeps the tx healthy
  // (a raw 23505 would abort it and roll back the stripe_events marker).
  if (input.metadata.kind === "topup") {
    const insertedLedger = await tx
      .insert(householdBalanceLedger)
      .values({
        householdId: input.metadata.householdId,
        entryType: "card_topup",
        amountCents: input.expectedAmount,
        stripeCheckoutSessionId: input.sessionId,
        stripePaymentIntentId: input.paymentIntentId,
        actorId: input.metadata.actorId,
      })
      .onConflictDoNothing({
        target: householdBalanceLedger.stripeCheckoutSessionId,
        where: sql`entry_type IN ('card_topup', 'package_purchase')`,
      })
      .returning({ id: householdBalanceLedger.id });

    const ledgerId = insertedLedger[0]?.id;
    if (!ledgerId) return { kind: "already_credited" };

    await tx.insert(householdAuditLog).values({
      householdId: input.metadata.householdId,
      actorId: input.metadata.actorId,
      action: "balance_card_topup",
      payload: {
        ledgerId,
        entryType: "card_topup",
        amountCents: input.expectedAmount,
        stripeSessionId: input.sessionId,
      },
    });
    const newBalanceCents = await getHouseholdBalance(
      input.metadata.householdId,
      tx,
    );
    return {
      kind: "written",
      amountPaidCents: input.expectedAmount,
      bonusCents: 0,
      newBalanceCents,
    };
  }

  // Package purchase writes both rows in one go so the balance moves by
  // the full credit atomically (ADR 036 §1, package purchase block).
  const { priceCents, bonusCents } = packagePrice(
    input.metadata.packageTier,
    input.metadata.swimmerCount,
  );

  const insertedPurchase = await tx
    .insert(householdBalanceLedger)
    .values({
      householdId: input.metadata.householdId,
      entryType: "package_purchase",
      amountCents: priceCents,
      stripeCheckoutSessionId: input.sessionId,
      stripePaymentIntentId: input.paymentIntentId,
      actorId: input.metadata.actorId,
    })
    .onConflictDoNothing({
      target: householdBalanceLedger.stripeCheckoutSessionId,
      where: sql`entry_type IN ('card_topup', 'package_purchase')`,
    })
    .returning({ id: householdBalanceLedger.id });

  const purchaseLedgerId = insertedPurchase[0]?.id;
  if (!purchaseLedgerId) return { kind: "already_credited" };

  const insertedBonus = await tx
    .insert(householdBalanceLedger)
    .values({
      householdId: input.metadata.householdId,
      entryType: "package_bonus",
      amountCents: bonusCents,
      stripeCheckoutSessionId: input.sessionId,
      stripePaymentIntentId: input.paymentIntentId,
      actorId: input.metadata.actorId,
    })
    .returning({ id: householdBalanceLedger.id });

  const bonusLedgerId = insertedBonus[0]?.id;
  if (!bonusLedgerId) {
    throw new Error(
      "package_bonus insert returned no row (expected RETURNING id)",
    );
  }

  await tx
    .insert(householdAuditLog)
    .values([
      {
        householdId: input.metadata.householdId,
        actorId: input.metadata.actorId,
        action: "balance_package_purchased",
        payload: {
          ledgerId: purchaseLedgerId,
          entryType: "package_purchase",
          amountCents: priceCents,
          stripeSessionId: input.sessionId,
        },
      },
      {
        householdId: input.metadata.householdId,
        actorId: input.metadata.actorId,
        action: "balance_package_purchased",
        payload: {
          ledgerId: bonusLedgerId,
          entryType: "package_bonus",
          amountCents: bonusCents,
          stripeSessionId: input.sessionId,
        },
      },
    ]);
  const newBalanceCents = await getHouseholdBalance(
    input.metadata.householdId,
    tx,
  );
  return {
    kind: "written",
    amountPaidCents: priceCents,
    bonusCents,
    newBalanceCents,
  };
}

