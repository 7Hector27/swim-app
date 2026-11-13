// Cash-out refund engine integration tests (ADR 036 Phase 8 Part B).
//
// Exercises the real DB — the two new entry-type CHECKs, the append-only
// trigger, the per-household balance advisory lock — plus the stubbed
// Stripe refund boundary. The cash-out service writes the ledger rows
// and drain jobs in one transaction; the drain is a separate pass with
// its own retry/backoff state machine.

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
  lessons,
  lessonLocations,
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

// Silent log sink so error-level drain logs don't pollute the test output.
const silentLog = pino({ level: "silent" });

let owner: TestUser;
let coach: TestUser | undefined;
let locationId: string;
const seededLessonIds: string[] = [];

async function seedLesson(): Promise<string> {
  // A real lesson row so the lesson_charge ledger FK is satisfied.
  const startsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  const inserted = await adminDb()
    .insert(lessons)
    .values({
      householdId: owner.householdId,
      locationId,
      startsAt,
      durationMinutes: 30,
      type: "private",
      status: "approved",
    })
    .returning({ id: lessons.id });
  const id = inserted[0]?.id;
  if (!id) throw new Error("seedLesson: insert returned no row");
  seededLessonIds.push(id);
  return id;
}

async function uniqueSessionId(prefix: string): Promise<string> {
  return `cs_test_${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

async function uniquePaymentIntentId(prefix: string): Promise<string> {
  return `pi_test_${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

async function clearHousehold(): Promise<void> {
  // Append-only trigger blocks DELETE; bypass with session_replication_
  // role=replica for test cleanup only (same pattern as every other
  // balance integration test). cash_refund_jobs FK points at ledger
  // rows, so delete it first.
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
  // Clear needs-manual-handling notifications; getActiveCoachProfile
  // picks an arbitrary coach in a shared test DB, so key on category.
  await adminDb()
    .delete(coachNotifications)
    .where(eq(coachNotifications.category, "cash_refund_needs_manual_handling"));
}

beforeAll(async () => {
  owner = await createTestUser("cashout-owner");
  coach = await createTestUser("cashout-coach");
  await adminDb()
    .update(profiles)
    .set({ role: "coach" })
    .where(eq(profiles.id, coach.userId));
  const locs = await adminDb()
    .select({ id: lessonLocations.id })
    .from(lessonLocations)
    .where(eq(lessonLocations.isActive, true))
    .limit(1);
  const found = locs[0]?.id;
  if (!found) throw new Error("No active lesson location in test stack");
  locationId = found;
});

afterEach(async () => {
  await clearHousehold();
});

afterAll(async () => {
  await clearHousehold();
  if (seededLessonIds.length > 0) {
    await adminDb()
      .delete(lessons)
      .where(eq(lessons.householdId, owner.householdId));
  }
  await owner.cleanup();
  if (coach) await coach.cleanup();
  await closeAdminDb();
});

// ── Helpers ─────────────────────────────────────────────────────────────

async function seedCardTopup(args: {
  amountCents: number;
  sessionIdPrefix?: string;
  paymentIntentId?: string;
}): Promise<string> {
  const sessionId = await uniqueSessionId(args.sessionIdPrefix ?? "topup");
  return await withBalanceLock(owner.householdId, async (tx) =>
    applyLedgerEntry(tx, {
      entryType: "card_topup",
      householdId: owner.householdId,
      actorId: owner.userId,
      amountCents: args.amountCents,
      stripeCheckoutSessionId: sessionId,
      stripePaymentIntentId: args.paymentIntentId ?? null,
    }),
  );
}

async function seedPackage(args: {
  priceCents: number;
  bonusCents: number;
  sessionIdPrefix?: string;
  paymentIntentId?: string;
}): Promise<{ purchaseId: string; bonusId: string; sessionId: string }> {
  const sessionId = await uniqueSessionId(args.sessionIdPrefix ?? "pkg");
  const paymentIntentId = args.paymentIntentId ?? (await uniquePaymentIntentId("pkg"));
  return await withBalanceLock(owner.householdId, async (tx) => {
    const purchaseId = await applyLedgerEntry(tx, {
      entryType: "package_purchase",
      householdId: owner.householdId,
      actorId: owner.userId,
      amountCents: args.priceCents,
      stripeCheckoutSessionId: sessionId,
      stripePaymentIntentId: paymentIntentId,
    });
    const bonusId = await applyLedgerEntry(tx, {
      entryType: "package_bonus",
      householdId: owner.householdId,
      actorId: owner.userId,
      amountCents: args.bonusCents,
      stripeCheckoutSessionId: sessionId,
      stripePaymentIntentId: paymentIntentId,
    });
    return { purchaseId, bonusId, sessionId };
  });
}

async function seedLessonCharge(amountCents: number): Promise<string> {
  const lessonId = await seedLesson();
  return await withBalanceLock(owner.householdId, async (tx) =>
    applyLedgerEntry(tx, {
      entryType: "lesson_charge",
      householdId: owner.householdId,
      actorId: owner.userId,
      amountCents,
      lessonId,
    }),
  );
}

async function seedCoachGift(amountCents: number, reason: string): Promise<string> {
  return await withBalanceLock(owner.householdId, async (tx) =>
    applyLedgerEntry(tx, {
      entryType: "coach_adjustment",
      householdId: owner.householdId,
      actorId: owner.userId,
      amountCents,
      reason,
    }),
  );
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("executeCashOut — refund rule", () => {
  it("Deep End package, $480 of lessons taken → refunds $1,440 to card and writes off $480", async () => {
    // Deep End for 1 swimmer: paid $1,920, bonus $480 → $2,400 credit.
    // Then $480 of lessons taken. Refund rule:
    //   totalCardPaid - totalCashRefunded - netLessonSpending
    //   = 1920 - 0 - 480 = 1440 → refund $1,440 to card.
    //   currentBalance = 2400 - 480 = 1920.
    //   writeOff = 1920 - 1440 = 480. Matches the bonus.
    const { purchaseId } = await seedPackage({
      priceCents: 192_000,
      bonusCents: 48_000,
      paymentIntentId: await uniquePaymentIntentId("deep-end"),
    });
    await seedLessonCharge(-48_000);

    const result = await executeCashOut({
      householdId: owner.householdId,
      actorId: owner.userId,
    });

    expect(result.breakdown.totalCardPaidCents).toBe(192_000);
    expect(result.breakdown.netLessonSpendingCents).toBe(48_000);
    expect(result.breakdown.currentBalanceCents).toBe(192_000);
    expect(result.breakdown.refundableCents).toBe(144_000);
    expect(result.breakdown.writeOffCents).toBe(48_000);

    // One cash_refund row for −$1,440 pointing at the package_purchase.
    const refundRows = await adminDb()
      .select({
        amountCents: householdBalanceLedger.amountCents,
        refundOf: householdBalanceLedger.refundOfLedgerId,
      })
      .from(householdBalanceLedger)
      .where(
        and(
          eq(householdBalanceLedger.householdId, owner.householdId),
          eq(householdBalanceLedger.entryType, "cash_refund"),
        ),
      );
    expect(refundRows).toHaveLength(1);
    expect(refundRows[0]?.amountCents).toBe(-144_000);
    expect(refundRows[0]?.refundOf).toBe(purchaseId);

    // One balance_writeoff row for −$480.
    const writeoffRows = await adminDb()
      .select({ amountCents: householdBalanceLedger.amountCents })
      .from(householdBalanceLedger)
      .where(
        and(
          eq(householdBalanceLedger.householdId, owner.householdId),
          eq(householdBalanceLedger.entryType, "balance_writeoff"),
        ),
      );
    expect(writeoffRows).toHaveLength(1);
    expect(writeoffRows[0]?.amountCents).toBe(-48_000);

    // Balance = 0.
    const balanceRows = await adminDb()
      .select({
        sum: sql<string>`COALESCE(SUM(${householdBalanceLedger.amountCents}), 0)`,
      })
      .from(householdBalanceLedger)
      .where(eq(householdBalanceLedger.householdId, owner.householdId));
    expect(Number(balanceRows[0]?.sum ?? "0")).toBe(0);

    // One pending drain job.
    const jobRows = await adminDb()
      .select({
        amountCents: cashRefundJobs.amountCents,
        status: cashRefundJobs.status,
      })
      .from(cashRefundJobs)
      .where(eq(cashRefundJobs.householdId, owner.householdId));
    expect(jobRows).toHaveLength(1);
    expect(jobRows[0]?.amountCents).toBe(144_000);
    expect(jobRows[0]?.status).toBe("pending");

    // Email outbox row.
    const emailRows = await adminDb()
      .select({
        payload: lessonEmailOutbox.payload,
      })
      .from(lessonEmailOutbox)
      .where(
        and(
          eq(lessonEmailOutbox.householdId, owner.householdId),
          eq(lessonEmailOutbox.event, "balance_cashed_out"),
        ),
      );
    expect(emailRows).toHaveLength(1);
    const payload = emailRows[0]?.payload as {
      totalCardPaidCents: number;
      refundableCents: number;
      writeOffCents: number;
    };
    expect(payload.totalCardPaidCents).toBe(192_000);
    expect(payload.refundableCents).toBe(144_000);
    expect(payload.writeOffCents).toBe(48_000);
  });

  it("single top-up partly used refunds the remainder with no write-off", async () => {
    // $200 top-up, $90 lesson → refund $110, writeoff $0.
    await seedCardTopup({
      amountCents: 20_000,
      paymentIntentId: await uniquePaymentIntentId("topup"),
    });
    await seedLessonCharge(-9_000);

    const result = await executeCashOut({
      householdId: owner.householdId,
      actorId: owner.userId,
    });

    expect(result.breakdown.refundableCents).toBe(11_000);
    expect(result.breakdown.writeOffCents).toBe(0);
    expect(result.cashRefundLedgerIds).toHaveLength(1);
    expect(result.writeOffLedgerId).toBeNull();

    const refundRows = await adminDb()
      .select({ amountCents: householdBalanceLedger.amountCents })
      .from(householdBalanceLedger)
      .where(
        and(
          eq(householdBalanceLedger.householdId, owner.householdId),
          eq(householdBalanceLedger.entryType, "cash_refund"),
        ),
      );
    expect(refundRows).toHaveLength(1);
    expect(refundRows[0]?.amountCents).toBe(-11_000);

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

    const balanceRows = await adminDb()
      .select({
        sum: sql<string>`COALESCE(SUM(${householdBalanceLedger.amountCents}), 0)`,
      })
      .from(householdBalanceLedger)
      .where(eq(householdBalanceLedger.householdId, owner.householdId));
    expect(Number(balanceRows[0]?.sum ?? "0")).toBe(0);

    const emailRows = await adminDb()
      .select({ payload: lessonEmailOutbox.payload })
      .from(lessonEmailOutbox)
      .where(
        and(
          eq(lessonEmailOutbox.householdId, owner.householdId),
          eq(lessonEmailOutbox.event, "balance_cashed_out"),
        ),
      );
    expect(emailRows).toHaveLength(1);
    const payload = emailRows[0]?.payload as { refundableCents: number; writeOffCents: number };
    expect(payload.refundableCents).toBe(11_000);
    expect(payload.writeOffCents).toBe(0);
  });

  it("mixed top-ups and packages allocate newest-first across payments", async () => {
    // Card top-up $100 (oldest) + package $1,080 (newest) + bonus $120 +
    // lesson_charge -$600. Refund rule:
    //   totalCardPaid = 100 + 1080 = 1180
    //   netLessonSpending = 600
    //   refundable = 1180 - 600 = 580
    //   balance = 1180 + 120 - 600 = 700
    //   writeOff = 700 - 580 = 120  (the bonus)
    // Allocation is newest-first → the whole $580 comes off the package.
    const topupPi = await uniquePaymentIntentId("mix-topup");
    const packagePi = await uniquePaymentIntentId("mix-package");
    await seedCardTopup({ amountCents: 10_000, paymentIntentId: topupPi });
    // Ensure the package is strictly newer than the top-up. Timestamps
    // have millisecond resolution; sleep 10ms is enough.
    await new Promise((resolve) => setTimeout(resolve, 10));
    const pkg = await seedPackage({
      priceCents: 108_000,
      bonusCents: 12_000,
      paymentIntentId: packagePi,
    });
    await seedLessonCharge(-60_000);

    const result = await executeCashOut({
      householdId: owner.householdId,
      actorId: owner.userId,
    });

    expect(result.breakdown.refundableCents).toBe(58_000);
    expect(result.breakdown.writeOffCents).toBe(12_000);

    const refundRows = await adminDb()
      .select({
        amountCents: householdBalanceLedger.amountCents,
        refundOf: householdBalanceLedger.refundOfLedgerId,
      })
      .from(householdBalanceLedger)
      .where(
        and(
          eq(householdBalanceLedger.householdId, owner.householdId),
          eq(householdBalanceLedger.entryType, "cash_refund"),
        ),
      );
    expect(refundRows).toHaveLength(1);
    expect(refundRows[0]?.amountCents).toBe(-58_000);
    expect(refundRows[0]?.refundOf).toBe(pkg.purchaseId);

    const writeoffRows = await adminDb()
      .select({ amountCents: householdBalanceLedger.amountCents })
      .from(householdBalanceLedger)
      .where(
        and(
          eq(householdBalanceLedger.householdId, owner.householdId),
          eq(householdBalanceLedger.entryType, "balance_writeoff"),
        ),
      );
    expect(writeoffRows).toHaveLength(1);
    expect(writeoffRows[0]?.amountCents).toBe(-12_000);

    const balanceRows = await adminDb()
      .select({
        sum: sql<string>`COALESCE(SUM(${householdBalanceLedger.amountCents}), 0)`,
      })
      .from(householdBalanceLedger)
      .where(eq(householdBalanceLedger.householdId, owner.householdId));
    expect(Number(balanceRows[0]?.sum ?? "0")).toBe(0);

    const emailRows = await adminDb()
      .select({ payload: lessonEmailOutbox.payload })
      .from(lessonEmailOutbox)
      .where(
        and(
          eq(lessonEmailOutbox.householdId, owner.householdId),
          eq(lessonEmailOutbox.event, "balance_cashed_out"),
        ),
      );
    expect(emailRows).toHaveLength(1);
    const payload = emailRows[0]?.payload as {
      refundableCents: number;
      writeOffCents: number;
    };
    expect(payload.refundableCents).toBe(58_000);
    expect(payload.writeOffCents).toBe(12_000);
  });

  it("coach gift stays in write-off and never hits a cash refund", async () => {
    // Top-up $200 + coach gift $100 (adjustment) + lesson -$50. Refund
    // rule:
    //   totalCardPaid = 200, netLessonSpending = 50 → refund 150
    //   balance = 200 + 100 - 50 = 250
    //   writeOff = 250 - 150 = 100  (the gift)
    await seedCardTopup({
      amountCents: 20_000,
      paymentIntentId: await uniquePaymentIntentId("gift-topup"),
    });
    await seedCoachGift(10_000, "thanks for a great season");
    await seedLessonCharge(-5_000);

    const result = await executeCashOut({
      householdId: owner.householdId,
      actorId: owner.userId,
    });

    expect(result.breakdown.refundableCents).toBe(15_000);
    expect(result.breakdown.writeOffCents).toBe(10_000);

    const refundRows = await adminDb()
      .select({ amountCents: householdBalanceLedger.amountCents })
      .from(householdBalanceLedger)
      .where(
        and(
          eq(householdBalanceLedger.householdId, owner.householdId),
          eq(householdBalanceLedger.entryType, "cash_refund"),
        ),
      );
    expect(refundRows).toHaveLength(1);
    expect(refundRows[0]?.amountCents).toBe(-15_000);

    const writeoffRows = await adminDb()
      .select({ amountCents: householdBalanceLedger.amountCents })
      .from(householdBalanceLedger)
      .where(
        and(
          eq(householdBalanceLedger.householdId, owner.householdId),
          eq(householdBalanceLedger.entryType, "balance_writeoff"),
        ),
      );
    expect(writeoffRows).toHaveLength(1);
    expect(writeoffRows[0]?.amountCents).toBe(-10_000);

    const balanceRows = await adminDb()
      .select({
        sum: sql<string>`COALESCE(SUM(${householdBalanceLedger.amountCents}), 0)`,
      })
      .from(householdBalanceLedger)
      .where(eq(householdBalanceLedger.householdId, owner.householdId));
    expect(Number(balanceRows[0]?.sum ?? "0")).toBe(0);

    const emailRows = await adminDb()
      .select({ payload: lessonEmailOutbox.payload })
      .from(lessonEmailOutbox)
      .where(
        and(
          eq(lessonEmailOutbox.householdId, owner.householdId),
          eq(lessonEmailOutbox.event, "balance_cashed_out"),
        ),
      );
    expect(emailRows).toHaveLength(1);
    const payload = emailRows[0]?.payload as {
      refundableCents: number;
      writeOffCents: number;
    };
    expect(payload.refundableCents).toBe(15_000);
    expect(payload.writeOffCents).toBe(10_000);
  });

  it("concurrent cash-out requests serialize — second sees zero balance and no-ops", async () => {
    await seedCardTopup({
      amountCents: 20_000,
      paymentIntentId: await uniquePaymentIntentId("concurrent"),
    });

    const [first, second] = await Promise.all([
      executeCashOut({ householdId: owner.householdId, actorId: owner.userId }),
      executeCashOut({ householdId: owner.householdId, actorId: owner.userId }),
    ]);

    // One of the two did the work; the other saw zero balance and no-op'd.
    const did = [first, second].find((r) => r.cashRefundLedgerIds.length > 0);
    const noop = [first, second].find((r) => r.cashRefundLedgerIds.length === 0);
    if (!did || !noop) {
      throw new Error(
        `expected exactly one caller to do the work, got ${JSON.stringify({
          first,
          second,
        })}`,
      );
    }

    expect(did.breakdown.refundableCents).toBe(20_000);
    expect(did.writeOffLedgerId).toBeNull();
    expect(noop.breakdown.currentBalanceCents).toBe(0);
    expect(noop.breakdown.refundableCents).toBe(0);
    expect(noop.breakdown.writeOffCents).toBe(0);
    expect(noop.writeOffLedgerId).toBeNull();
    expect(noop.cashRefundJobIds).toHaveLength(0);

    // Exactly one cash_refund ledger row on the DB.
    const refundRows = await adminDb()
      .select({ id: householdBalanceLedger.id })
      .from(householdBalanceLedger)
      .where(
        and(
          eq(householdBalanceLedger.householdId, owner.householdId),
          eq(householdBalanceLedger.entryType, "cash_refund"),
        ),
      );
    expect(refundRows).toHaveLength(1);
  });
});

describe("cash-refund drain", () => {
  it("Stripe failure on first attempt retries and succeeds on second", async () => {
    await seedCardTopup({
      amountCents: 20_000,
      paymentIntentId: await uniquePaymentIntentId("retry"),
    });
    const result = await executeCashOut({
      householdId: owner.householdId,
      actorId: owner.userId,
    });
    const jobId = result.cashRefundJobIds[0];
    if (!jobId) throw new Error("expected one job");

    // Make the job immediately eligible — the service seeded a 2-minute
    // lead window so the real cron tick wouldn't race the post-commit
    // kick; tests don't need that.
    await adminDb()
      .update(cashRefundJobs)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(cashRefundJobs.id, jobId));

    let callCount = 0;
    const stubCreateRefund = async (): Promise<CreateRefundResult> => {
      callCount += 1;
      if (callCount === 1) {
        return { ok: false, retryable: true, reason: "stripe_connection:econn" };
      }
      return { ok: true, stripeRefundId: `re_test_${callCount}` };
    };

    // First drain pass: fails retryably, attempts bumped to 1.
    const firstPass = await runCashRefundRetryDrain(silentLog, {
      createRefund: stubCreateRefund,
    });
    expect(firstPass.attempted).toBe(1);
    expect(firstPass.succeeded).toBe(0);

    const afterFirst = await adminDb()
      .select({
        attempts: cashRefundJobs.attempts,
        status: cashRefundJobs.status,
        lastError: cashRefundJobs.lastError,
      })
      .from(cashRefundJobs)
      .where(eq(cashRefundJobs.id, jobId));
    expect(afterFirst[0]?.attempts).toBe(1);
    expect(afterFirst[0]?.status).toBe("pending");
    expect(afterFirst[0]?.lastError).toBe("stripe_connection:econn");

    // Force eligible again (first pass pushed next_attempt_at out by the
    // backoff) and run the second pass — it should succeed.
    await adminDb()
      .update(cashRefundJobs)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(cashRefundJobs.id, jobId));

    const secondPass = await runCashRefundRetryDrain(silentLog, {
      createRefund: stubCreateRefund,
    });
    expect(secondPass.attempted).toBe(1);
    expect(secondPass.succeeded).toBe(1);

    const afterSecond = await adminDb()
      .select({
        status: cashRefundJobs.status,
        stripeRefundId: cashRefundJobs.stripeRefundId,
        succeededAt: cashRefundJobs.succeededAt,
      })
      .from(cashRefundJobs)
      .where(eq(cashRefundJobs.id, jobId));
    expect(afterSecond[0]?.status).toBe("succeeded");
    expect(afterSecond[0]?.stripeRefundId).toBe("re_test_2");
    expect(afterSecond[0]?.succeededAt).not.toBeNull();
  });

  it("unrefundable payment (Stripe refund window exceeded) marks the job needs_manual_handling and leaves the ledger write intact", async () => {
    await seedCardTopup({
      amountCents: 20_000,
      paymentIntentId: await uniquePaymentIntentId("expired"),
    });
    const result = await executeCashOut({
      householdId: owner.householdId,
      actorId: owner.userId,
    });
    const jobId = result.cashRefundJobIds[0];
    const ledgerId = result.cashRefundLedgerIds[0];
    if (!jobId || !ledgerId) throw new Error("expected one job + ledger row");

    await adminDb()
      .update(cashRefundJobs)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(cashRefundJobs.id, jobId));

    const errorLogs: Array<Record<string, unknown>> = [];
    // Pipe the capture into a silent transport so the test output stays
    // clean. The hook still inspects the args.
    const captureLog = pino(
      {
        level: "error",
        hooks: {
          logMethod(args, method) {
            const first = args[0];
            if (first && typeof first === "object") {
              errorLogs.push(first as Record<string, unknown>);
            }
            return method.apply(this, args);
          },
        },
      },
      { write: () => {} },
    );

    const stubCreateRefund = async (): Promise<CreateRefundResult> => ({
      ok: false,
      retryable: false,
      reason: "stripe_error:charge_expired_for_refund",
    });

    const pass = await runCashRefundRetryDrain(captureLog, {
      createRefund: stubCreateRefund,
    });
    expect(pass.attempted).toBe(1);
    expect(pass.needsManualHandling).toBe(1);

    const afterRows = await adminDb()
      .select({
        status: cashRefundJobs.status,
        lastError: cashRefundJobs.lastError,
      })
      .from(cashRefundJobs)
      .where(eq(cashRefundJobs.id, jobId));
    expect(afterRows[0]?.status).toBe("needs_manual_handling");
    expect(afterRows[0]?.lastError).toBe("stripe_error:charge_expired_for_refund");

    // Ledger row stays — nothing to roll back on append-only.
    const ledgerRows = await adminDb()
      .select({ id: householdBalanceLedger.id })
      .from(householdBalanceLedger)
      .where(eq(householdBalanceLedger.id, ledgerId));
    expect(ledgerRows).toHaveLength(1);

    // Error log fired with the expected event name.
    const match = errorLogs.find(
      (entry) => entry["event"] === "cash_refund_needs_manual_handling",
    );
    expect(match).toBeDefined();

    // Stop 2: terminal transition also inserts a coach notification
    // so Jason's family-page banner surfaces the "needs manual" job.
    // getActiveCoachProfile picks an arbitrary coach in a shared test
    // DB, so key the query on the jobId-derived tag.
    const notifs = await adminDb()
      .select({
        category: coachNotifications.category,
      })
      .from(coachNotifications)
      .where(eq(coachNotifications.tag, `cash-refund-needs-manual:${jobId}`));
    expect(notifs).toHaveLength(1);
    expect(notifs[0]?.category).toBe("cash_refund_needs_manual_handling");
  });
});
