// GET /coach/cash-refunds/needs-attention (ADR 036 Phase 8 Part B).
//
// Covers:
//   1. empty list when no jobs need manual handling
//   2. lists jobs with a live household (name surfaces)
//   3. lists jobs from deleted families with household=null
//   4. newest-first ordering across live and deleted entries
//   5. succeeded and pending jobs are filtered out

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import pino from "pino";
import { and, eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

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
  households,
  profiles,
} from "../../db/schema";

const app = createApp(pino({ level: "silent" }));

let coach: TestUser;
const createdOwners: TestUser[] = [];

async function uniquePaymentIntentId(prefix: string): Promise<string> {
  return `pi_test_${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

/**
 * Insert a `cash_refund_jobs` row directly (no ledger/service plumbing)
 * so a test can set exactly the shape it wants to observe. The
 * append-only ledger trigger would reject the scaffolding we'd need
 * otherwise. `household_id` is nullable in the schema, so an
 * intentionally-null row seeds the "deleted family" path without
 * running the deletion flow.
 */
async function insertJob(args: {
  householdId: string | null;
  amountCents: number;
  status: "pending" | "succeeded" | "needs_manual_handling";
  needsManualReason?: string | null;
  stripePaymentIntentId?: string | null;
  createdAt?: Date;
}): Promise<string> {
  const paymentIntentId = args.stripePaymentIntentId ?? null;
  const ledgerId = await adminDb().transaction(async (tx) => {
    // The cash_refund_jobs row needs a ledger_id FK target. Write a
    // throwaway cash_refund ledger row via raw SQL (bypassing the
    // append-only trigger is not necessary — inserts are fine) with
    // whatever household_id we're seeding for.
    await tx.execute(sql`SET LOCAL session_replication_role = replica`);
    const ledgerRows = await tx.execute<{ id: string }>(sql`
      INSERT INTO household_balance_ledger (
        household_id, entry_type, amount_cents, stripe_payment_intent_id
      )
      VALUES (
        ${args.householdId},
        'cash_refund',
        ${-args.amountCents},
        ${paymentIntentId}
      )
      RETURNING id
    `);
    return ledgerRows[0]?.id as string;
  });

  const jobId = await adminDb().transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL session_replication_role = replica`);
    const createdAtIso = (args.createdAt ?? new Date()).toISOString();
    // succeeded_at is required when status='succeeded' (CHECK
    // constraint succeeded_requires_timestamp).
    const succeededAtIso = args.status === "succeeded" ? createdAtIso : null;
    const rows = await tx.execute<{ id: string }>(sql`
      INSERT INTO cash_refund_jobs (
        ledger_id,
        household_id,
        stripe_payment_intent_id,
        idempotency_key,
        amount_cents,
        status,
        needs_manual_reason,
        attempts,
        created_at,
        next_attempt_at,
        succeeded_at
      )
      VALUES (
        ${ledgerId},
        ${args.householdId},
        ${paymentIntentId},
        ${randomUUID()},
        ${args.amountCents},
        ${args.status}::cash_refund_job_status,
        ${args.needsManualReason ?? null},
        0,
        ${createdAtIso}::timestamptz,
        ${createdAtIso}::timestamptz,
        ${succeededAtIso}::timestamptz
      )
      RETURNING id
    `);
    return rows[0]?.id as string;
  });
  return jobId;
}

/**
 * Deletes every cash_refund_jobs row this test file seeded — both live
 * and anonymized (household_id null) — plus their ledger rows. Running
 * between tests keeps each case hermetic.
 */
async function clearAllJobs(): Promise<void> {
  await adminDb().transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL session_replication_role = replica`);
    await tx.execute(sql`DELETE FROM cash_refund_jobs`);
    await tx.execute(
      sql`DELETE FROM household_balance_ledger WHERE entry_type::text = 'cash_refund'`,
    );
  });
}

beforeAll(async () => {
  coach = await createTestUser("needs-attention-coach");
  await adminDb()
    .update(profiles)
    .set({ role: "coach" })
    .where(eq(profiles.id, coach.userId));
});

afterEach(async () => {
  await clearAllJobs();
  for (const owner of createdOwners.splice(0)) {
    await owner.cleanup().catch(() => { /* best-effort */ });
  }
});

afterAll(async () => {
  await clearAllJobs();
  await coach.cleanup();
  await closeAdminDb();
});

describe("GET /coach/cash-refunds/needs-attention", () => {
  it("returns an empty list when no jobs need manual handling", async () => {
    const response = await request(app)
      .get("/coach/cash-refunds/needs-attention")
      .set("Authorization", `Bearer ${coach.accessToken}`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ jobs: [] });
  });

  it("lists jobs with a live household and shows the family name", async () => {
    const owner = await createTestUser("needs-attention-live");
    createdOwners.push(owner);
    const distinctiveName = `Live-Fam-${Date.now()}`;
    await adminDb()
      .update(households)
      .set({ name: distinctiveName })
      .where(eq(households.id, owner.householdId));

    const paymentIntentId = await uniquePaymentIntentId("live");
    const jobId = await insertJob({
      householdId: owner.householdId,
      amountCents: 12_500,
      status: "needs_manual_handling",
      needsManualReason: "stripe_refund_failed:stripe_error:charge_expired_for_refund",
      stripePaymentIntentId: paymentIntentId,
    });

    const response = await request(app)
      .get("/coach/cash-refunds/needs-attention")
      .set("Authorization", `Bearer ${coach.accessToken}`);
    expect(response.status).toBe(200);
    expect(response.body.jobs).toHaveLength(1);
    const entry = response.body.jobs[0];
    expect(entry.jobId).toBe(jobId);
    expect(entry.amountCents).toBe(12_500);
    expect(entry.reason).toBe("Stripe refund failed");
    expect(entry.stripePaymentIntentId).toBe(paymentIntentId);
    expect(entry.household).toEqual({
      id: owner.householdId,
      name: distinctiveName,
    });
  });

  it("lists jobs from deleted families with household=null", async () => {
    // Direct insert with household_id=null mimics the post-anonymization
    // state. No live household row exists for this job.
    const jobId = await insertJob({
      householdId: null,
      amountCents: 6_000,
      status: "needs_manual_handling",
      needsManualReason: "no_refundable_card_payment",
      stripePaymentIntentId: null,
    });

    const response = await request(app)
      .get("/coach/cash-refunds/needs-attention")
      .set("Authorization", `Bearer ${coach.accessToken}`);
    expect(response.status).toBe(200);
    expect(response.body.jobs).toHaveLength(1);
    const entry = response.body.jobs[0];
    expect(entry.jobId).toBe(jobId);
    expect(entry.amountCents).toBe(6_000);
    expect(entry.reason).toBe("No matching card payment");
    expect(entry.stripePaymentIntentId).toBeNull();
    expect(entry.household).toBeNull();
  });

  it("orders newest-first across live and deleted entries", async () => {
    const owner = await createTestUser("needs-attention-order");
    createdOwners.push(owner);

    // Three jobs at distinct times — oldest, middle, newest. Order them
    // deliberately out of insertion order to prove createdAt wins.
    const now = Date.now();
    const oldJobId = await insertJob({
      householdId: null,
      amountCents: 1_000,
      status: "needs_manual_handling",
      needsManualReason: "no_refundable_card_payment",
      createdAt: new Date(now - 3 * 60_000),
    });
    const newJobId = await insertJob({
      householdId: owner.householdId,
      amountCents: 3_000,
      status: "needs_manual_handling",
      needsManualReason: "stripe_refund_failed:stripe_error:charge_expired_for_refund",
      stripePaymentIntentId: "pi_test_newest",
      createdAt: new Date(now),
    });
    const midJobId = await insertJob({
      householdId: null,
      amountCents: 2_000,
      status: "needs_manual_handling",
      needsManualReason: "no_refundable_card_payment",
      createdAt: new Date(now - 60_000),
    });

    const response = await request(app)
      .get("/coach/cash-refunds/needs-attention")
      .set("Authorization", `Bearer ${coach.accessToken}`);
    expect(response.status).toBe(200);
    expect(response.body.jobs).toHaveLength(3);
    const ids = response.body.jobs.map(
      (entry: { jobId: string }) => entry.jobId,
    );
    expect(ids).toEqual([newJobId, midJobId, oldJobId]);
  });

  it("succeeded and pending jobs are filtered out", async () => {
    const owner = await createTestUser("needs-attention-filter");
    createdOwners.push(owner);

    const succeededId = await insertJob({
      householdId: owner.householdId,
      amountCents: 4_000,
      status: "succeeded",
      stripePaymentIntentId: "pi_succeeded",
    });
    const pendingId = await insertJob({
      householdId: owner.householdId,
      amountCents: 5_000,
      status: "pending",
      stripePaymentIntentId: "pi_pending",
    });
    const needsManualId = await insertJob({
      householdId: owner.householdId,
      amountCents: 6_000,
      status: "needs_manual_handling",
      needsManualReason: "no_refundable_card_payment",
      stripePaymentIntentId: null,
    });

    const response = await request(app)
      .get("/coach/cash-refunds/needs-attention")
      .set("Authorization", `Bearer ${coach.accessToken}`);
    expect(response.status).toBe(200);
    const ids = response.body.jobs.map(
      (entry: { jobId: string }) => entry.jobId,
    );
    expect(ids).toEqual([needsManualId]);
    // Belt-and-braces: the filtered-out ids are not in the response.
    expect(ids).not.toContain(succeededId);
    expect(ids).not.toContain(pendingId);
  });
});

// Silence unused-import warnings on helpers not every test exercises.
void inArray;
void and;
void coachAuditLog;
void coachNotifications;
void cashRefundJobs;
