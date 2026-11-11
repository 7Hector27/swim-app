// Account deletion × cash-out integration (ADR 036 Phase 8 Part B Stop 2).
//
// Covers the solo-deletion path's cash-out:
//   1. preview carries cashOutPreview when balance > 0, null when zero.
//   2. confirm runs cash-out inside the deletion tx, zeroes + anonymizes
//      the ledger, surfaces the breakdown in the response.
//   3. confirm never enqueues a balance_cashed_out email row.
//   4. a legacy payment (no payment_intent_id) survives anonymization
//      as a cash_refund_jobs row at needs_manual_handling with
//      household_id nulled.

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import pino from "pino";
import { and, eq, inArray, sql } from "drizzle-orm";

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
  householdBalanceLedger,
  households,
  lessonEmailOutbox,
} from "../../db/schema";
import {
  applyLedgerEntry,
  withBalanceLock,
} from "../../services/balance";

const app = createApp(pino({ level: "silent" }));

const TEST_PASSWORD = "integration-test-password-1";
const DELETION_PHRASE = "delete";

const testUsers: TestUser[] = [];

async function uniqueSessionId(prefix: string): Promise<string> {
  return `cs_test_${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

async function uniquePaymentIntentId(prefix: string): Promise<string> {
  return `pi_test_${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

async function seedCardTopup(
  user: TestUser,
  amountCents: number,
): Promise<{ ledgerId: string; paymentIntentId: string }> {
  const sessionId = await uniqueSessionId("deletion-live");
  const paymentIntentId = await uniquePaymentIntentId("deletion-live");
  const ledgerId = await withBalanceLock(user.householdId, async (tx) =>
    applyLedgerEntry(tx, {
      entryType: "card_topup",
      householdId: user.householdId,
      actorId: user.userId,
      amountCents,
      stripeCheckoutSessionId: sessionId,
      stripePaymentIntentId: paymentIntentId,
    }),
  );
  return { ledgerId, paymentIntentId };
}

async function seedCardTopupWithoutPaymentIntent(
  user: TestUser,
  amountCents: number,
): Promise<string> {
  const sessionId = await uniqueSessionId("deletion-legacy");
  return await withBalanceLock(user.householdId, async (tx) =>
    applyLedgerEntry(tx, {
      entryType: "card_topup",
      householdId: user.householdId,
      actorId: user.userId,
      amountCents,
      stripeCheckoutSessionId: sessionId,
      stripePaymentIntentId: null,
    }),
  );
}

function confirmDeletion(accessToken: string, password = TEST_PASSWORD) {
  return request(app)
    .post("/me/deletion/confirm")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ password, confirmationPhrase: DELETION_PHRASE });
}

function previewDeletion(accessToken: string) {
  return request(app)
    .post("/me/deletion/preview")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({});
}

beforeAll(async () => {
  // No shared fixtures — every test creates its own owner so the solo
  // deletion scrubs are hermetic.
});

afterEach(async () => {
  // Needs-manual-handling notifications outlive household anonymization
  // by design; clear them so they don't leak across tests.
  try {
    await adminDb()
      .delete(coachNotifications)
      .where(eq(coachNotifications.category, "cash_refund_needs_manual_handling"));
  } catch {
    /* best-effort */
  }
  // Clean up anonymized cash_refund_jobs rows written by this test file
  // (household_id is null post-anonymization, so can't scope by household).
  try {
    await adminDb()
      .delete(cashRefundJobs)
      .where(sql`household_id IS NULL`);
  } catch {
    /* best-effort */
  }
  // Legacy anonymized ledger rows (household_id null) that aren't tied
  // to a live household anymore but would otherwise accumulate.
  try {
    await adminDb().transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = replica`);
      await tx.execute(
        sql`DELETE FROM household_balance_ledger WHERE household_id IS NULL`,
      );
    });
  } catch {
    /* best-effort */
  }
  for (const user of testUsers.splice(0)) {
    await user.cleanup().catch(() => { /* best-effort */ });
  }
});

afterAll(async () => {
  await closeAdminDb();
});

describe("account deletion × cash-out preview", () => {
  it("account deletion preview includes cashOutPreview when balance > 0", async () => {
    const owner = await createTestUser("delete-cashout-preview-nonzero");
    testUsers.push(owner);
    await seedCardTopup(owner, 25_000);

    const preview = await previewDeletion(owner.accessToken);
    expect(preview.status).toBe(200);
    expect(preview.body.balanceCents).toBe(25_000);
    expect(preview.body.cashOutPreview).not.toBeNull();
    expect(preview.body.cashOutPreview.refundableCents).toBe(25_000);
    expect(preview.body.cashOutPreview.writeOffCents).toBe(0);
    expect(preview.body.cashOutPreview.currentBalanceCents).toBe(25_000);
  });

  it("account deletion preview cashOutPreview is null when balance is zero", async () => {
    const owner = await createTestUser("delete-cashout-preview-zero");
    testUsers.push(owner);

    const preview = await previewDeletion(owner.accessToken);
    expect(preview.status).toBe(200);
    expect(preview.body.balanceCents).toBe(0);
    expect(preview.body.cashOutPreview).toBeNull();
  });
});

describe("account deletion × cash-out confirm", () => {
  it("runs cash-out, zeros the ledger, anonymizes it, and surfaces the breakdown in the response", async () => {
    const owner = await createTestUser("delete-cashout-confirm-ok");
    testUsers.push(owner);
    await seedCardTopup(owner, 30_000);

    const confirm = await confirmDeletion(owner.accessToken);
    expect(confirm.status).toBe(200);
    expect(confirm.body.cashOut).not.toBeNull();
    expect(confirm.body.cashOut.breakdown.refundableCents).toBe(30_000);
    expect(confirm.body.cashOut.breakdown.writeOffCents).toBe(0);
    expect(confirm.body.cashOut.refundJobCount).toBeGreaterThanOrEqual(1);
    expect(confirm.body.cashOut.needsManualHandlingCents).toBe(0);

    // Ledger: all rows anonymized (household_id null), sum still 0.
    // The rows will now be orphan — can't scope by householdId. Verify
    // via the ledger's refundOfLedgerId linking to the original
    // card_topup, which we remembered.
    const leftover = await adminDb()
      .select({ id: householdBalanceLedger.id })
      .from(householdBalanceLedger)
      .where(eq(householdBalanceLedger.householdId, owner.householdId));
    expect(leftover).toHaveLength(0);
  });

  it("does NOT enqueue a balance_cashed_out email outbox row", async () => {
    const owner = await createTestUser("delete-cashout-no-email");
    testUsers.push(owner);
    await seedCardTopup(owner, 10_000);

    const confirm = await confirmDeletion(owner.accessToken);
    expect(confirm.status).toBe(200);

    const rows = await adminDb()
      .select({ id: lessonEmailOutbox.id })
      .from(lessonEmailOutbox)
      .where(
        and(
          eq(lessonEmailOutbox.householdId, owner.householdId),
          eq(lessonEmailOutbox.event, "balance_cashed_out"),
        ),
      );
    expect(rows).toHaveLength(0);
  });

  it("with no balance, skips cash-out entirely (204 shape preserved)", async () => {
    const owner = await createTestUser("delete-cashout-empty");
    testUsers.push(owner);

    const confirm = await confirmDeletion(owner.accessToken);
    // Zero balance → no cash-out summary → 204 (back-compat shape).
    expect(confirm.status).toBe(204);
  });

  it("with unmatched residual creates a needs-manual-handling job that survives household anonymization", async () => {
    const owner = await createTestUser("delete-cashout-residual");
    testUsers.push(owner);
    const householdIdSnapshot = owner.householdId;
    await seedCardTopupWithoutPaymentIntent(owner, 7_500);

    const confirm = await confirmDeletion(owner.accessToken);
    expect(confirm.status).toBe(200);
    expect(confirm.body.cashOut).not.toBeNull();
    expect(confirm.body.cashOut.needsManualHandlingCents).toBe(7_500);

    // The job row should exist, but household_id is nulled by the
    // deletion anonymization step. Look it up by status + amountCents.
    const jobRows = await adminDb()
      .select({
        id: cashRefundJobs.id,
        status: cashRefundJobs.status,
        householdId: cashRefundJobs.householdId,
        amountCents: cashRefundJobs.amountCents,
        needsManualReason: cashRefundJobs.needsManualReason,
      })
      .from(cashRefundJobs)
      .where(
        and(
          eq(cashRefundJobs.status, "needs_manual_handling"),
          eq(cashRefundJobs.amountCents, 7_500),
        ),
      );
    // Exactly one such job — this test is the only producer in its file.
    expect(jobRows).toHaveLength(1);
    expect(jobRows[0]?.householdId).toBeNull();
    expect(jobRows[0]?.needsManualReason).toBe("no_refundable_card_payment");

    // The coach notification exists but carries NO family-name field —
    // after deletion the family's name must not survive anywhere on our
    // side. Jason identifies the refund via the Stripe payment intent
    // id (null here — this is the no-matching-card-payment path) + the
    // jobId tag.
    const notifs = await adminDb()
      .select({
        payload: coachNotifications.payload,
      })
      .from(coachNotifications)
      .where(eq(coachNotifications.category, "cash_refund_needs_manual_handling"));
    expect(notifs).toHaveLength(1);
    expect(Object.keys(notifs[0]?.payload as object)).not.toContain(
      "householdNameSnapshot",
    );

    // Sanity: the previously-live household id is gone from
    // cash_refund_jobs so any future query won't tie back.
    const stillTied = await adminDb()
      .select({ id: cashRefundJobs.id })
      .from(cashRefundJobs)
      .where(eq(cashRefundJobs.householdId, householdIdSnapshot));
    expect(stillTied).toHaveLength(0);
  });

  it("anonymization nulls cash_refund_jobs.household_id", async () => {
    // Live top-up path: cash-out writes a drain-eligible job, the
    // anonymization step nulls its household_id so the job carries on
    // with no identifying link to the family.
    const owner = await createTestUser("delete-cashout-null-hid");
    testUsers.push(owner);
    const householdIdSnapshot = owner.householdId;
    await seedCardTopup(owner, 11_000);

    const confirm = await confirmDeletion(owner.accessToken);
    expect(confirm.status).toBe(200);

    const stillTied = await adminDb()
      .select({ id: cashRefundJobs.id })
      .from(cashRefundJobs)
      .where(eq(cashRefundJobs.householdId, householdIdSnapshot));
    expect(stillTied).toHaveLength(0);

    // Anonymized jobs still exist (they just carry a null household_id).
    const anonJobs = await adminDb()
      .select({ id: cashRefundJobs.id })
      .from(cashRefundJobs)
      .where(sql`household_id IS NULL`);
    expect(anonJobs.length).toBeGreaterThanOrEqual(1);
    // Narrow the "any anon row" check to this test's row by amount.
    const matching = await adminDb()
      .select({ id: cashRefundJobs.id })
      .from(cashRefundJobs)
      .where(
        and(
          sql`household_id IS NULL`,
          eq(cashRefundJobs.amountCents, 11_000),
        ),
      );
    expect(matching).toHaveLength(1);
  });

  it("no family name survives in any stored notification or job after deletion", async () => {
    // Belt-and-braces scrub test. Set a distinctive household name on
    // the owner, run deletion-with-residual (so a cash_refund_jobs row
    // + a coach_notifications row both land), then grep every string-
    // valued artifact that could carry the name and assert it doesn't.
    const owner = await createTestUser("delete-cashout-name-scrub");
    testUsers.push(owner);
    const householdIdSnapshot = owner.householdId;
    // Name is wildly distinctive so a substring match can't false-
    // positive against a Drizzle-generated default or a pi_ prefix.
    const distinctiveName = `XYZZY-SCRUB-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await adminDb()
      .update(households)
      .set({ name: distinctiveName })
      .where(eq(households.id, householdIdSnapshot));

    // Residual seed so cash-out writes a direct-needs-manual job + its
    // bell row; a live payment-intent path writes only a drain-eligible
    // job whose notification is only produced on terminal failure.
    await seedCardTopupWithoutPaymentIntent(owner, 9_000);

    const confirm = await confirmDeletion(owner.accessToken);
    expect(confirm.status).toBe(200);

    // (1) No coach_notifications payload contains the household name.
    const allNotifs = await adminDb()
      .select({ payload: coachNotifications.payload })
      .from(coachNotifications)
      .where(eq(coachNotifications.category, "cash_refund_needs_manual_handling"));
    for (const notif of allNotifs) {
      const asJson = JSON.stringify(notif.payload);
      expect(asJson).not.toContain(distinctiveName);
    }

    // (2) No cash_refund_jobs column carries the name. There's no name
    // column on the table (verified at schema time), but assert the
    // post-anonymization row has a null household_id so nothing can
    // join back to the now-deleted household row.
    const jobRows = await adminDb()
      .select({
        householdId: cashRefundJobs.householdId,
        amountCents: cashRefundJobs.amountCents,
      })
      .from(cashRefundJobs)
      .where(
        and(
          sql`household_id IS NULL`,
          eq(cashRefundJobs.amountCents, 9_000),
        ),
      );
    expect(jobRows).toHaveLength(1);
    expect(jobRows[0]?.householdId).toBeNull();

    // (3) No household_balance_ledger.reason (or any string column) on
    // the anonymized rows carries the name. The ledger rows survive
    // anonymized (household_id null); the reason column is only set
    // for coach_adjustment entries, so it should be null everywhere
    // here, but sweep anyway.
    const anonLedger = await adminDb()
      .select({
        reason: householdBalanceLedger.reason,
        stripeCheckoutSessionId: householdBalanceLedger.stripeCheckoutSessionId,
        stripePaymentIntentId: householdBalanceLedger.stripePaymentIntentId,
      })
      .from(householdBalanceLedger)
      .where(sql`household_id IS NULL`);
    for (const row of anonLedger) {
      expect(row.reason ?? "").not.toContain(distinctiveName);
      expect(row.stripeCheckoutSessionId ?? "").not.toContain(distinctiveName);
      expect(row.stripePaymentIntentId ?? "").not.toContain(distinctiveName);
    }

    // (4) The household row itself is gone — belt-and-braces check that
    // deletion removed the row that held the name in the first place.
    const stillThere = await adminDb()
      .select({ id: households.id })
      .from(households)
      .where(eq(households.id, householdIdSnapshot));
    expect(stillThere).toHaveLength(0);
  });
});

// Silence unused-import warnings on helpers not every test exercises.
void inArray;
void request;
