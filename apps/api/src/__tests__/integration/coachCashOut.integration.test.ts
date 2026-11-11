// Coach cash-out endpoints (ADR 036 Phase 8 Part B Stop 2).
//
// Covers:
//   GET  /coach/households/:id/balance/cash-out/preview
//   POST /coach/households/:id/balance/cash-out
//   GET  /coach/households/:id/needs-manual-refund
//   POST /coach/cash-refund-jobs/:jobId/mark-refunded

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
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
  coachAuditLog,
  coachNotifications,
  householdAuditLog,
  lessonEmailOutbox,
  profiles,
} from "../../db/schema";
import {
  applyLedgerEntry,
  withBalanceLock,
} from "../../services/balance";
import { __setStripeClientForTests } from "../../services/stripe";

const app = createApp(pino({ level: "silent" }));

// Stripe stub — the post-commit kick (`kickCashRefundDrain`) fires a
// microtask after every successful cash-out, which calls `refunds.create`.
// Tests mustn't hit real Stripe, so we install a minimal stub that
// records calls and returns a fake refund id.
const refundsCreateStub = vi.fn().mockImplementation(async () => ({
  id: `re_test_${Date.now()}_${Math.random().toString(36).slice(2)}`,
}));

function makeStubStripe() {
  return {
    checkout: {
      sessions: {
        create: vi.fn(async () => {
          throw new Error("stub: checkout.sessions.create not expected");
        }),
        retrieve: vi.fn(async () => {
          throw new Error("stub: checkout.sessions.retrieve not expected");
        }),
      },
    },
    refunds: {
      create: refundsCreateStub,
    },
    webhooks: {
      constructEvent: vi.fn(() => {
        throw new Error("stub: webhooks.constructEvent not expected");
      }),
    },
  } as unknown as Parameters<typeof __setStripeClientForTests>[0];
}

// Poll until a condition holds or the timeout elapses — the drain
// kick is a queueMicrotask callback that awaits DB work, so simple
// setImmediate flushing isn't enough.
async function waitUntil(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 2_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await condition()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("waitUntil: condition did not hold within timeout");
}

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
  await adminDb()
    .delete(coachNotifications)
    .where(eq(coachNotifications.category, "cash_refund_needs_manual_handling"));
  await adminDb()
    .delete(coachAuditLog)
    .where(eq(coachAuditLog.action, "cash_refund_marked_handled"));
}

async function seedCardTopup(amountCents: number): Promise<{ ledgerId: string; paymentIntentId: string }> {
  const sessionId = await uniqueSessionId("coach-live");
  const paymentIntentId = await uniquePaymentIntentId("coach-live");
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

async function seedCardTopupWithoutPaymentIntent(amountCents: number): Promise<string> {
  const sessionId = await uniqueSessionId("coach-legacy");
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

beforeAll(async () => {
  coach = await createTestUser("coach-cashout-coach");
  owner = await createTestUser("coach-cashout-owner");
  await adminDb().update(profiles).set({ role: "coach" }).where(eq(profiles.id, coach.userId));
  __setStripeClientForTests(makeStubStripe());
});

afterEach(async () => {
  await clearHousehold();
  refundsCreateStub.mockClear();
});

afterAll(async () => {
  await clearHousehold();
  __setStripeClientForTests(undefined);
  await owner.cleanup();
  await coach.cleanup();
  await closeAdminDb();
});

describe("GET /coach/households/:id/balance/cash-out/preview", () => {
  it("returns the breakdown", async () => {
    await seedCardTopup(15_000);
    const res = await request(app)
      .get(`/coach/households/${owner.householdId}/balance/cash-out/preview`)
      .set("Authorization", `Bearer ${coach.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.totalCardPaidCents).toBe(15_000);
    expect(res.body.netLessonSpendingCents).toBe(0);
    expect(res.body.currentBalanceCents).toBe(15_000);
    expect(res.body.refundableCents).toBe(15_000);
    expect(res.body.writeOffCents).toBe(0);
  });
});

describe("POST /coach/households/:id/balance/cash-out", () => {
  it("executes and enqueues parent email", async () => {
    await seedCardTopup(12_000);
    const res = await request(app)
      .post(`/coach/households/${owner.householdId}/balance/cash-out`)
      .set("Authorization", `Bearer ${coach.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.breakdown.refundableCents).toBe(12_000);
    expect(res.body.refundJobCount).toBe(1);
    expect(res.body.needsManualHandlingCents).toBe(0);

    const emailRows = await adminDb()
      .select({ event: lessonEmailOutbox.event })
      .from(lessonEmailOutbox)
      .where(
        and(
          eq(lessonEmailOutbox.householdId, owner.householdId),
          eq(lessonEmailOutbox.event, "balance_cashed_out"),
        ),
      );
    expect(emailRows).toHaveLength(1);
  });

  it("kicks the drain immediately — Stripe refund fires without a cron tick", async () => {
    await seedCardTopup(20_000);
    const res = await request(app)
      .post(`/coach/households/${owner.householdId}/balance/cash-out`)
      .set("Authorization", `Bearer ${coach.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.refundJobCount).toBe(1);

    // The post-commit kick is a queueMicrotask callback that awaits
    // DB work. Poll until the stub records the call — if the kick
    // was broken (e.g. the 2-minute next_attempt_at window blocks
    // the drain's claim), this times out and the test fails loud.
    await waitUntil(() => refundsCreateStub.mock.calls.length > 0);

    // Stripe was called via the kick, not a cron tick — we never
    // invoked runCashRefundRetryDrain manually in this test.
    expect(refundsCreateStub).toHaveBeenCalledTimes(1);
    const callArgs = refundsCreateStub.mock.calls[0];
    expect(callArgs?.[0]).toMatchObject({ amount: 20_000 });

    // Job moved to succeeded by the kick's drain pass.
    await waitUntil(async () => {
      const rows = await adminDb()
        .select({ status: cashRefundJobs.status })
        .from(cashRefundJobs)
        .where(eq(cashRefundJobs.householdId, owner.householdId));
      return rows[0]?.status === "succeeded";
    });
    const jobRows = await adminDb()
      .select({ status: cashRefundJobs.status, refundId: cashRefundJobs.stripeRefundId })
      .from(cashRefundJobs)
      .where(eq(cashRefundJobs.householdId, owner.householdId));
    expect(jobRows).toHaveLength(1);
    expect(jobRows[0]?.status).toBe("succeeded");
    expect(jobRows[0]?.refundId).toMatch(/^re_test_/);
  });

  it("empty-balance cash-out is a no-op with refundJobCount=0", async () => {
    const res = await request(app)
      .post(`/coach/households/${owner.householdId}/balance/cash-out`)
      .set("Authorization", `Bearer ${coach.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.refundJobCount).toBe(0);
    expect(res.body.needsManualHandlingCents).toBe(0);

    const jobRows = await adminDb()
      .select({ id: cashRefundJobs.id })
      .from(cashRefundJobs)
      .where(eq(cashRefundJobs.householdId, owner.householdId));
    expect(jobRows).toHaveLength(0);
  });
});

describe("GET /coach/households/:id/needs-manual-refund", () => {
  it("surfaces pending manual-handling jobs with mapped reasons", async () => {
    // Legacy top-up → cash-out creates a direct needs_manual_handling job.
    await seedCardTopupWithoutPaymentIntent(8_000);
    const postRes = await request(app)
      .post(`/coach/households/${owner.householdId}/balance/cash-out`)
      .set("Authorization", `Bearer ${coach.accessToken}`);
    expect(postRes.status).toBe(200);
    expect(postRes.body.needsManualHandlingCents).toBe(8_000);

    const res = await request(app)
      .get(`/coach/households/${owner.householdId}/needs-manual-refund`)
      .set("Authorization", `Bearer ${coach.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.jobs).toHaveLength(1);
    expect(res.body.jobs[0].amountCents).toBe(8_000);
    expect(res.body.jobs[0].reason).toBe("No matching card payment");
    expect(typeof res.body.jobs[0].id).toBe("string");
    expect(typeof res.body.jobs[0].createdAt).toBe("string");
  });
});

describe("POST /coach/cash-refund-jobs/:jobId/mark-refunded", () => {
  it("transitions the job to succeeded and writes audit", async () => {
    // Set up a needs_manual_handling job via the legacy cash-out path.
    await seedCardTopupWithoutPaymentIntent(5_000);
    const cashOut = await request(app)
      .post(`/coach/households/${owner.householdId}/balance/cash-out`)
      .set("Authorization", `Bearer ${coach.accessToken}`);
    expect(cashOut.status).toBe(200);
    const jobRows = await adminDb()
      .select({ id: cashRefundJobs.id })
      .from(cashRefundJobs)
      .where(
        and(
          eq(cashRefundJobs.householdId, owner.householdId),
          eq(cashRefundJobs.status, "needs_manual_handling"),
        ),
      );
    const jobId = jobRows[0]?.id;
    if (!jobId) throw new Error("expected a needs_manual_handling job");

    const res = await request(app)
      .post(`/coach/cash-refund-jobs/${jobId}/mark-refunded`)
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send({ note: "Refunded via Stripe dashboard (ch_1A2B)" });
    expect(res.status).toBe(200);
    expect(res.body.jobId).toBe(jobId);
    expect(res.body.status).toBe("succeeded");

    const after = await adminDb()
      .select({
        status: cashRefundJobs.status,
        succeededAt: cashRefundJobs.succeededAt,
        resolutionNote: cashRefundJobs.resolutionNote,
        resolvedBy: cashRefundJobs.resolvedBy,
      })
      .from(cashRefundJobs)
      .where(eq(cashRefundJobs.id, jobId));
    expect(after[0]?.status).toBe("succeeded");
    expect(after[0]?.succeededAt).not.toBeNull();
    expect(after[0]?.resolutionNote).toBe("Refunded via Stripe dashboard (ch_1A2B)");
    expect(after[0]?.resolvedBy).toBe(coach.userId);

    const auditRows = await adminDb()
      .select({
        action: coachAuditLog.action,
        payload: coachAuditLog.payload,
      })
      .from(coachAuditLog)
      .where(
        and(
          eq(coachAuditLog.coachId, coach.userId),
          eq(coachAuditLog.action, "cash_refund_marked_handled"),
        ),
      );
    expect(auditRows).toHaveLength(1);
    const payload = auditRows[0]?.payload as {
      jobId: string;
      amountCents: number;
      note: string;
    };
    expect(payload.jobId).toBe(jobId);
    expect(payload.amountCents).toBe(5_000);
    expect(payload.note).toBe("Refunded via Stripe dashboard (ch_1A2B)");
  });

  it("returns 422 invalid_state on a pending job", async () => {
    // Live top-up → cash-out writes a pending job (drain-eligible).
    await seedCardTopup(6_000);
    const cashOut = await request(app)
      .post(`/coach/households/${owner.householdId}/balance/cash-out`)
      .set("Authorization", `Bearer ${coach.accessToken}`);
    expect(cashOut.status).toBe(200);
    const jobRows = await adminDb()
      .select({ id: cashRefundJobs.id, status: cashRefundJobs.status })
      .from(cashRefundJobs)
      .where(eq(cashRefundJobs.householdId, owner.householdId));
    const pending = jobRows.find((row) => row.status === "pending");
    const jobId = pending?.id;
    if (!jobId) throw new Error("expected a pending job");

    const res = await request(app)
      .post(`/coach/cash-refund-jobs/${jobId}/mark-refunded`)
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send({ note: "nope" });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("invalid_state");
  });

  it("returns 422 invalid_state on a succeeded job", async () => {
    await seedCardTopupWithoutPaymentIntent(4_000);
    const cashOut = await request(app)
      .post(`/coach/households/${owner.householdId}/balance/cash-out`)
      .set("Authorization", `Bearer ${coach.accessToken}`);
    expect(cashOut.status).toBe(200);
    const jobRows = await adminDb()
      .select({ id: cashRefundJobs.id })
      .from(cashRefundJobs)
      .where(eq(cashRefundJobs.householdId, owner.householdId));
    const jobId = jobRows[0]?.id;
    if (!jobId) throw new Error("expected a job");

    const first = await request(app)
      .post(`/coach/cash-refund-jobs/${jobId}/mark-refunded`)
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send({ note: "settled via Venmo" });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post(`/coach/cash-refund-jobs/${jobId}/mark-refunded`)
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send({ note: "trying again" });
    expect(second.status).toBe(422);
    expect(second.body.error).toBe("invalid_state");
  });
});
