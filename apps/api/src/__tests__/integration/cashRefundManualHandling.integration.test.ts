// Cash-refund needs-manual-handling (ADR 036 Phase 8 Part B Stop 2).
//
// Exercises the three new shapes:
//   1. Refundable residual that couldn't be matched to any live card
//      payment is written as its own `cash_refund` ledger row (null
//      Stripe ids) and lands the drain job directly at status=
//      'needs_manual_handling' with reason='no_refundable_card_payment'.
//   2. The direct-needs-manual insert path also writes a
//      `coach_notifications` row tagged by job id.
//   3. The drain's terminal path (Stripe refund permanently failing)
//      also writes a `coach_notifications` row tagged by job id.

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import pino from "pino";
import { and, eq, sql } from "drizzle-orm";

import { createApp } from "../../app";
import {
  adminDb,
  closeAdminDb,
  createTestUser,
  type TestUser,
} from "./helpers";
import {
  cashRefundJobs,
  coachNotifications,
  householdAuditLog,
  householdBalanceLedger,
  lessonEmailOutbox,
  profiles,
} from "../../db/schema";
import {
  applyLedgerEntry,
  executeCashOut,
  runCashRefundRetryDrain,
  withBalanceLock,
} from "../../services/balance";
import type { CreateRefundResult } from "../../services/stripe/refunds";

createApp(pino({ level: "silent" }));

const silentLog = pino({ level: "silent" });

let coach: TestUser;
let owner: TestUser;

async function uniqueSessionId(prefix: string): Promise<string> {
  return `cs_test_${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

async function uniquePaymentIntentId(prefix: string): Promise<string> {
  return `pi_test_${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

async function clearHousehold(): Promise<void> {
  await adminDb().transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL session_replication_role = replica`);
    await tx.execute(
      sql`DELETE FROM cash_refund_jobs WHERE household_id = ${owner.householdId}::uuid`,
    );
    await tx.execute(
      sql`DELETE FROM household_balance_ledger WHERE household_id = ${owner.householdId}::uuid`,
    );
  });
  await adminDb()
    .delete(householdAuditLog)
    .where(eq(householdAuditLog.householdId, owner.householdId));
  await adminDb()
    .delete(lessonEmailOutbox)
    .where(
      and(
        eq(lessonEmailOutbox.householdId, owner.householdId),
        eq(lessonEmailOutbox.event, "balance_cashed_out"),
      ),
    );
  // Clear coach notifications written by the needs-manual-handling
  // path. Keyed on category rather than profileId because
  // getActiveCoachProfile picks an arbitrary coach in a shared test DB.
  await adminDb()
    .delete(coachNotifications)
    .where(eq(coachNotifications.category, "cash_refund_needs_manual_handling"));
}

async function seedCardTopupWithoutPaymentIntent(amountCents: number): Promise<string> {
  const sessionId = await uniqueSessionId("legacy");
  return await withBalanceLock(owner.householdId, async (tx) =>
    applyLedgerEntry(tx, {
      entryType: "card_topup",
      householdId: owner.householdId,
      actorId: owner.userId,
      amountCents,
      stripeCheckoutSessionId: sessionId,
      stripePaymentIntentId: null,
    }),
  );
}

async function seedCardTopup(amountCents: number): Promise<{ ledgerId: string; paymentIntentId: string }> {
  const sessionId = await uniqueSessionId("live");
  const paymentIntentId = await uniquePaymentIntentId("live");
  const ledgerId = await withBalanceLock(owner.householdId, async (tx) =>
    applyLedgerEntry(tx, {
      entryType: "card_topup",
      householdId: owner.householdId,
      actorId: owner.userId,
      amountCents,
      stripeCheckoutSessionId: sessionId,
      stripePaymentIntentId: paymentIntentId,
    }),
  );
  return { ledgerId, paymentIntentId };
}

beforeAll(async () => {
  coach = await createTestUser("cashout-manual-coach");
  owner = await createTestUser("cashout-manual-owner");
  await adminDb().update(profiles).set({ role: "coach" }).where(eq(profiles.id, coach.userId));
});

afterEach(async () => {
  await clearHousehold();
});

afterAll(async () => {
  await clearHousehold();
  await owner.cleanup();
  await coach.cleanup();
  await closeAdminDb();
});

describe("cash-refund needs-manual-handling", () => {
  it("unmatched residual produces a cash_refund row with null stripe ids and a needs_manual_handling job on insert", async () => {
    // Legacy top-up: positive balance but no payment_intent_id on the
    // ledger row, so the cash-out allocator can't attach a Stripe
    // refund target. The residual becomes a cash_refund row with null
    // stripe ids + a drain job directly at needs_manual_handling.
    await seedCardTopupWithoutPaymentIntent(15_000);

    const result = await executeCashOut({
      householdId: owner.householdId,
      actorId: owner.userId,
    });

    expect(result.breakdown.refundableCents).toBe(15_000);
    expect(result.needsManualHandlingCents).toBe(15_000);

    const cashRefundRows = await adminDb()
      .select({
        amountCents: householdBalanceLedger.amountCents,
        stripeCheckoutSessionId: householdBalanceLedger.stripeCheckoutSessionId,
        stripePaymentIntentId: householdBalanceLedger.stripePaymentIntentId,
        refundOfLedgerId: householdBalanceLedger.refundOfLedgerId,
      })
      .from(householdBalanceLedger)
      .where(
        and(
          eq(householdBalanceLedger.householdId, owner.householdId),
          eq(householdBalanceLedger.entryType, "cash_refund"),
        ),
      );
    expect(cashRefundRows).toHaveLength(1);
    expect(cashRefundRows[0]?.amountCents).toBe(-15_000);
    expect(cashRefundRows[0]?.stripeCheckoutSessionId).toBeNull();
    expect(cashRefundRows[0]?.stripePaymentIntentId).toBeNull();
    expect(cashRefundRows[0]?.refundOfLedgerId).toBeNull();

    // No balance_writeoff row — legacy top-up is real card money, not a
    // gift or bonus credit.
    const writeoffRows = await adminDb()
      .select({ id: householdBalanceLedger.id })
      .from(householdBalanceLedger)
      .where(
        and(
          eq(householdBalanceLedger.householdId, owner.householdId),
          eq(householdBalanceLedger.entryType, "balance_writeoff"),
        ),
      );
    expect(writeoffRows).toHaveLength(0);

    // Balance = 0 after the cash-out.
    const balanceRows = await adminDb()
      .select({
        sum: sql<string>`COALESCE(SUM(${householdBalanceLedger.amountCents}), 0)`,
      })
      .from(householdBalanceLedger)
      .where(eq(householdBalanceLedger.householdId, owner.householdId));
    expect(Number(balanceRows[0]?.sum ?? "0")).toBe(0);

    // One job row at needs_manual_handling with the right reason.
    const jobRows = await adminDb()
      .select({
        id: cashRefundJobs.id,
        status: cashRefundJobs.status,
        attempts: cashRefundJobs.attempts,
        amountCents: cashRefundJobs.amountCents,
        stripePaymentIntentId: cashRefundJobs.stripePaymentIntentId,
        needsManualReason: cashRefundJobs.needsManualReason,
      })
      .from(cashRefundJobs)
      .where(eq(cashRefundJobs.householdId, owner.householdId));
    expect(jobRows).toHaveLength(1);
    expect(jobRows[0]?.status).toBe("needs_manual_handling");
    expect(jobRows[0]?.attempts).toBe(0);
    expect(jobRows[0]?.amountCents).toBe(15_000);
    expect(jobRows[0]?.stripePaymentIntentId).toBeNull();
    expect(jobRows[0]?.needsManualReason).toBe("no_refundable_card_payment");
  });

  it("direct-needs-manual job also inserts a coach notification tagged by job id", async () => {
    await seedCardTopupWithoutPaymentIntent(8_000);
    const result = await executeCashOut({
      householdId: owner.householdId,
      actorId: owner.userId,
    });
    const jobId = result.cashRefundJobIds[0];
    if (!jobId) throw new Error("expected a job id");

    // Fetch by the jobId-derived tag — getActiveCoachProfile picks an
    // arbitrary active coach, which in a shared test DB may not be the
    // one this file creates. The tag is the stable key.
    const notifs = await adminDb()
      .select({
        tag: coachNotifications.tag,
        category: coachNotifications.category,
        payload: coachNotifications.payload,
      })
      .from(coachNotifications)
      .where(eq(coachNotifications.tag, `cash-refund-needs-manual:${jobId}`));
    expect(notifs).toHaveLength(1);
    expect(notifs[0]?.category).toBe("cash_refund_needs_manual_handling");
    const payload = notifs[0]?.payload as {
      jobId: string;
      amountCents: number;
      reason: string;
      householdNameSnapshot: string | null;
    };
    expect(payload.jobId).toBe(jobId);
    expect(payload.amountCents).toBe(8_000);
    expect(payload.reason).toBe("No matching card payment");
    expect(typeof payload.householdNameSnapshot).toBe("string");
  });

  it("drain transition to needs_manual_handling also inserts a coach notification tagged by job id", async () => {
    // Live payment intent → cash-out writes a normal drain-eligible
    // job. Force the drain stub to permanently fail; the terminal
    // transition writes the bell row.
    await seedCardTopup(12_000);
    const result = await executeCashOut({
      householdId: owner.householdId,
      actorId: owner.userId,
    });
    const jobId = result.cashRefundJobIds[0];
    if (!jobId) throw new Error("expected a job id");

    await adminDb()
      .update(cashRefundJobs)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(cashRefundJobs.id, jobId));

    const stubCreateRefund = async (): Promise<CreateRefundResult> => ({
      ok: false,
      retryable: false,
      reason: "stripe_error:charge_expired_for_refund",
    });

    const pass = await runCashRefundRetryDrain(silentLog, {
      createRefund: stubCreateRefund,
    });
    expect(pass.needsManualHandling).toBe(1);

    const jobRows = await adminDb()
      .select({
        status: cashRefundJobs.status,
        needsManualReason: cashRefundJobs.needsManualReason,
      })
      .from(cashRefundJobs)
      .where(eq(cashRefundJobs.id, jobId));
    expect(jobRows[0]?.status).toBe("needs_manual_handling");
    expect(jobRows[0]?.needsManualReason).toBe(
      "stripe_refund_failed:stripe_error:charge_expired_for_refund",
    );

    const notifs = await adminDb()
      .select({
        tag: coachNotifications.tag,
        payload: coachNotifications.payload,
      })
      .from(coachNotifications)
      .where(eq(coachNotifications.tag, `cash-refund-needs-manual:${jobId}`));
    expect(notifs).toHaveLength(1);
    const payload = notifs[0]?.payload as { reason: string; jobId: string };
    expect(payload.jobId).toBe(jobId);
    expect(payload.reason).toBe("Stripe refund failed");
  });
});
