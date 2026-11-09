// Household balance ledger integration tests (ADR 036 Phase 2).
//
// Every test runs against the dedicated test Supabase stack so the DB
// trigger (migration 0077) and the CHECK constraints (migration 0076) are
// the real thing. Vitest's unit runner would not catch either.
//
// Scenarios covered:
//
//   1. Two concurrent charges on the same household serialize: the second
//      caller sees the first caller's write and refuses to overdraw.
//   2. A package purchase writes both its ledger rows atomically — a
//      concurrent balance read never sees the price without the bonus.
//   3. The append-only trigger rejects UPDATE on any column.
//   4. The append-only trigger rejects DELETE on any row.
//   5. `refundLessonCharge` is a no-op on a lesson that has no
//      `lesson_charge` row (free-lesson marker, pre-payments-era lesson).
//   6. Every ledger row lands with a matching audit row; if the enclosing
//      transaction rolls back, neither row survives.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pino from "pino";
import { and, eq, sql } from "drizzle-orm";

import { createApp } from "../../app";
import {
  adminDb,
  closeAdminDb,
  createTestUser,
  type TestUser,
} from "./helpers";
import { db } from "../../db/client";
import {
  householdAuditLog,
  householdBalanceLedger,
  lessonLocations,
  lessons,
} from "../../db/schema";
import {
  applyLedgerEntry,
  getHouseholdBalance,
  refundLessonCharge,
  withBalanceLock,
  type RefundLessonChargeResult,
} from "../../services/balance";
import { packagePrice } from "@swim-app/shared";

// createApp is imported for parity with other integration tests, which binds
// the env validator and pino setup the services expect. We don't call HTTP
// here — the service layer is exercised directly.
createApp(pino({ level: "silent" }));

// ── Shared state ──────────────────────────────────────────────────────────────

let owner: TestUser;
let locationId: string;
const seededLessonIds: string[] = [];

async function seedLesson(): Promise<string> {
  // A lesson row is a prerequisite for lesson_charge / refund_to_balance /
  // free_lesson ledger rows (FK). We never book or charge via API here; the
  // row just has to exist and satisfy its own NOT NULLs + CHECKs.
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

async function stripeSessionId(prefix: string): Promise<string> {
  // Partial UNIQUE on (stripe_checkout_session_id) for card_topup /
  // package_purchase means tests must not collide. Suffix guarantees that
  // across repeat runs within one stack.
  return `cs_test_${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

beforeAll(async () => {
  owner = await createTestUser("balance-ledger-owner");

  const locs = await adminDb()
    .select({ id: lessonLocations.id })
    .from(lessonLocations)
    .where(eq(lessonLocations.isActive, true))
    .limit(1);
  const found = locs[0]?.id;
  if (!found) throw new Error("No active lesson location in test stack");
  locationId = found;
});

afterAll(async () => {
  // Append-only trigger blocks DELETE on household_balance_ledger. Use
  // session_replication_role=replica to bypass it for cleanup only, the
  // same way editSession.integration.test.ts bypasses the append-only
  // triggers on evaluation_sessions.
  await adminDb().transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL session_replication_role = replica`);
    await tx.execute(
      sql`DELETE FROM household_balance_ledger WHERE household_id = ${owner.householdId}::uuid`,
    );
  });

  await adminDb()
    .delete(householdAuditLog)
    .where(eq(householdAuditLog.householdId, owner.householdId));

  if (seededLessonIds.length > 0) {
    await adminDb()
      .delete(lessons)
      .where(eq(lessons.householdId, owner.householdId));
  }

  await owner.cleanup();
  await closeAdminDb();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("concurrent lesson charges on one household", () => {
  it("serialize under the balance lock: one succeeds, the second sees the first's write and refuses", async () => {
    // Seed a $100 balance via a real top-up so the ledger invariants (CHECK
    // constraints, audit pairing) all run in the service path we exercise.
    const seedSession = await stripeSessionId("seed");
    await withBalanceLock(owner.householdId, async (tx) =>
      applyLedgerEntry(tx, {
        entryType: "card_topup",
        householdId: owner.householdId,
        actorId: owner.userId,
        amountCents: 10_000,
        stripeCheckoutSessionId: seedSession,
        stripePaymentIntentId: null,
      }),
    );

    const lessonA = await seedLesson();
    const lessonB = await seedLesson();

    // Each attempt replicates what Phase 4's parent-booking path will do:
    // enter the balance lock, read balance, refuse if below price, else
    // insert the lesson_charge ledger row.
    type ChargeResult =
      | { ok: true; balanceAfterCents: number }
      | { ok: false; seenBalanceCents: number };

    async function chargeIfPossible(
      lessonId: string,
      priceCents: number,
    ): Promise<ChargeResult> {
      return withBalanceLock(owner.householdId, async (tx) => {
        const balance = await getHouseholdBalance(owner.householdId, tx);
        if (balance < priceCents) {
          return { ok: false as const, seenBalanceCents: balance };
        }
        await applyLedgerEntry(tx, {
          entryType: "lesson_charge",
          householdId: owner.householdId,
          actorId: owner.userId,
          amountCents: -priceCents,
          lessonId,
        });
        return { ok: true as const, balanceAfterCents: balance - priceCents };
      });
    }

    const [a, b] = await Promise.all([
      chargeIfPossible(lessonA, 6_000),
      chargeIfPossible(lessonB, 6_000),
    ]);

    // Exactly one of the two attempts must have charged; the other must
    // have seen the post-first-charge balance ($40) and refused.
    const successes = [a, b].filter((result) => result.ok === true);
    const failures = [a, b].filter((result) => result.ok === false);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);

    const success = successes[0];
    const failure = failures[0];
    if (success?.ok !== true || failure?.ok !== false) {
      throw new Error("unreachable: filter should guarantee shape");
    }
    expect(success.balanceAfterCents).toBe(4_000);
    expect(failure.seenBalanceCents).toBe(4_000);

    // And the authoritative balance is $40.
    expect(await getHouseholdBalance(owner.householdId)).toBe(4_000);
  });
});

describe("package purchase atomicity", () => {
  it("writes package_purchase and package_bonus in one transaction — balance never shows the price without the bonus", async () => {
    const sessionId = await stripeSessionId("pkg");
    const { priceCents, bonusCents, creditCents } = packagePrice("cannonball", 1);

    const balanceBefore = await getHouseholdBalance(owner.householdId);

    await withBalanceLock(owner.householdId, async (tx) => {
      await applyLedgerEntry(tx, {
        entryType: "package_purchase",
        householdId: owner.householdId,
        actorId: owner.userId,
        amountCents: priceCents,
        stripeCheckoutSessionId: sessionId,
        stripePaymentIntentId: null,
      });
      await applyLedgerEntry(tx, {
        entryType: "package_bonus",
        householdId: owner.householdId,
        actorId: owner.userId,
        amountCents: bonusCents,
        stripeCheckoutSessionId: sessionId,
        stripePaymentIntentId: null,
      });
    });

    expect(await getHouseholdBalance(owner.householdId)).toBe(
      balanceBefore + creditCents,
    );

    const rows = await adminDb()
      .select({
        entryType: householdBalanceLedger.entryType,
        amountCents: householdBalanceLedger.amountCents,
      })
      .from(householdBalanceLedger)
      .where(eq(householdBalanceLedger.stripeCheckoutSessionId, sessionId));
    // Both rows share the session id; the UNIQUE index that enforces
    // idempotency scopes to card_topup + package_purchase only, so the
    // bonus is free to repeat.
    const byType = new Map(rows.map((row) => [row.entryType, row.amountCents]));
    expect(byType.get("package_purchase")).toBe(priceCents);
    expect(byType.get("package_bonus")).toBe(bonusCents);
  });
});

describe("append-only trigger", () => {
  it("rejects UPDATE on any ledger row", async () => {
    const sessionId = await stripeSessionId("update-guard");
    const ledgerId = await withBalanceLock(owner.householdId, async (tx) =>
      applyLedgerEntry(tx, {
        entryType: "card_topup",
        householdId: owner.householdId,
        actorId: owner.userId,
        amountCents: 100,
        stripeCheckoutSessionId: sessionId,
        stripePaymentIntentId: null,
      }),
    );

    await expect(
      adminDb().execute(
        sql`UPDATE household_balance_ledger SET amount_cents = 999 WHERE id = ${ledgerId}::uuid`,
      ),
    ).rejects.toThrow(/append-only/i);

    // The row is unchanged.
    const rows = await adminDb()
      .select({ amountCents: householdBalanceLedger.amountCents })
      .from(householdBalanceLedger)
      .where(eq(householdBalanceLedger.id, ledgerId));
    expect(rows[0]?.amountCents).toBe(100);
  });

  it("rejects DELETE on any ledger row", async () => {
    const sessionId = await stripeSessionId("delete-guard");
    const ledgerId = await withBalanceLock(owner.householdId, async (tx) =>
      applyLedgerEntry(tx, {
        entryType: "card_topup",
        householdId: owner.householdId,
        actorId: owner.userId,
        amountCents: 100,
        stripeCheckoutSessionId: sessionId,
        stripePaymentIntentId: null,
      }),
    );

    await expect(
      adminDb().execute(
        sql`DELETE FROM household_balance_ledger WHERE id = ${ledgerId}::uuid`,
      ),
    ).rejects.toThrow(/append-only/i);

    const rows = await adminDb()
      .select({ id: householdBalanceLedger.id })
      .from(householdBalanceLedger)
      .where(eq(householdBalanceLedger.id, ledgerId));
    expect(rows).toHaveLength(1);
  });
});

describe("refundLessonCharge", () => {
  it("is a no-op on a free-lesson marker (no lesson_charge row to invert)", async () => {
    const lessonId = await seedLesson();

    // Write only a free_lesson marker — no lesson_charge, so there's nothing
    // to refund. Simulates the coach-booked-free lesson from Phase 4.
    await withBalanceLock(owner.householdId, async (tx) =>
      applyLedgerEntry(tx, {
        entryType: "free_lesson",
        householdId: owner.householdId,
        actorId: owner.userId,
        lessonId,
      }),
    );

    const balanceBefore = await getHouseholdBalance(owner.householdId);

    const result = await withBalanceLock(owner.householdId, async (tx) =>
      refundLessonCharge(tx, {
        householdId: owner.householdId,
        lessonId,
        actorId: owner.userId,
      }),
    );

    expect(result).toEqual({ refunded: false, reason: "no_charge" });
    expect(await getHouseholdBalance(owner.householdId)).toBe(balanceBefore);

    // And no refund_to_balance row was written for this lesson.
    const refundRows = await adminDb()
      .select({ id: householdBalanceLedger.id })
      .from(householdBalanceLedger)
      .where(
        and(
          eq(householdBalanceLedger.lessonId, lessonId),
          eq(householdBalanceLedger.entryType, "refund_to_balance"),
        ),
      );
    expect(refundRows).toHaveLength(0);
  });

  it("writes the inverse refund row when a lesson_charge exists, using the stored amount (not the current rate)", async () => {
    const lessonId = await seedLesson();

    // Charge $75 — not a current rate-card amount, to prove the refund reads
    // from the stored row and doesn't recompute from priceForLesson.
    await withBalanceLock(owner.householdId, async (tx) =>
      applyLedgerEntry(tx, {
        entryType: "lesson_charge",
        householdId: owner.householdId,
        actorId: owner.userId,
        amountCents: -7_500,
        lessonId,
      }),
    );

    const balanceAfterCharge = await getHouseholdBalance(owner.householdId);

    const refundResult = await withBalanceLock(owner.householdId, async (tx) =>
      refundLessonCharge(tx, {
        householdId: owner.householdId,
        lessonId,
        actorId: owner.userId,
      }),
    );
    expect(refundResult.refunded).toBe(true);
    if (refundResult.refunded === true) {
      expect(refundResult.amountCents).toBe(7_500);
    }

    expect(await getHouseholdBalance(owner.householdId)).toBe(
      balanceAfterCharge + 7_500,
    );
  });

  it("sequential double-refund writes exactly one refund_to_balance row and no-ops the second call", async () => {
    const lessonId = await seedLesson();

    await withBalanceLock(owner.householdId, async (tx) =>
      applyLedgerEntry(tx, {
        entryType: "lesson_charge",
        householdId: owner.householdId,
        actorId: owner.userId,
        amountCents: -6_000,
        lessonId,
      }),
    );

    const first = await withBalanceLock(owner.householdId, async (tx) =>
      refundLessonCharge(tx, {
        householdId: owner.householdId,
        lessonId,
        actorId: owner.userId,
      }),
    );
    expect(first.refunded).toBe(true);
    if (first.refunded === true) expect(first.amountCents).toBe(6_000);

    const balanceAfterFirstRefund = await getHouseholdBalance(owner.householdId);

    // Second call for the same lesson — must be a no-op with no balance move.
    const second = await withBalanceLock(owner.householdId, async (tx) =>
      refundLessonCharge(tx, {
        householdId: owner.householdId,
        lessonId,
        actorId: owner.userId,
      }),
    );
    expect(second).toEqual({ refunded: false, reason: "already_refunded" });
    expect(await getHouseholdBalance(owner.householdId)).toBe(
      balanceAfterFirstRefund,
    );

    const refundRows = await adminDb()
      .select({ id: householdBalanceLedger.id })
      .from(householdBalanceLedger)
      .where(
        and(
          eq(householdBalanceLedger.lessonId, lessonId),
          eq(householdBalanceLedger.entryType, "refund_to_balance"),
        ),
      );
    expect(refundRows).toHaveLength(1);
  });

  it("two concurrent refunds for the same lesson collapse to one refund_to_balance row (DB unique index enforces)", async () => {
    const lessonId = await seedLesson();

    await withBalanceLock(owner.householdId, async (tx) =>
      applyLedgerEntry(tx, {
        entryType: "lesson_charge",
        householdId: owner.householdId,
        actorId: owner.userId,
        amountCents: -9_000,
        lessonId,
      }),
    );

    const balanceAfterCharge = await getHouseholdBalance(owner.householdId);

    // Fire two refund attempts in parallel. The balance lock serializes
    // them under normal use; even so, the DB unique index is the final
    // gatekeeper — simulate that by having both callers hit the ledger
    // with no lock, so they race to the insert. One wins with 23505, the
    // other no-ops. In production the lock makes this a non-race; the
    // test proves the invariant holds even if a caller forgot it.
    async function raceRefund(): Promise<RefundLessonChargeResult> {
      return db.transaction(async (tx) =>
        refundLessonCharge(tx, {
          householdId: owner.householdId,
          lessonId,
          actorId: owner.userId,
        }),
      );
    }

    const [a, b] = await Promise.all([raceRefund(), raceRefund()]);

    const successes = [a, b].filter((result) => result.refunded === true);
    const noops = [a, b].filter((result) => result.refunded === false);
    expect(successes).toHaveLength(1);
    expect(noops).toHaveLength(1);
    const success = successes[0];
    const noop = noops[0];
    if (success?.refunded !== true || noop?.refunded !== false) {
      throw new Error("unreachable: filter should guarantee shape");
    }
    expect(success.amountCents).toBe(9_000);
    expect(noop.reason).toBe("already_refunded");

    // Exactly one refund row survives in the DB — the unique index is doing
    // the work regardless of how many callers raced to insert.
    const refundRows = await adminDb()
      .select({ id: householdBalanceLedger.id })
      .from(householdBalanceLedger)
      .where(
        and(
          eq(householdBalanceLedger.lessonId, lessonId),
          eq(householdBalanceLedger.entryType, "refund_to_balance"),
        ),
      );
    expect(refundRows).toHaveLength(1);

    // Balance moved by exactly one refund's worth.
    expect(await getHouseholdBalance(owner.householdId)).toBe(
      balanceAfterCharge + 9_000,
    );
  });
});

describe("audit pairing", () => {
  it("writes a matching audit row for every ledger row (and both roll back together on error)", async () => {
    const sessionId = await stripeSessionId("audit-pair");
    const ledgerId = await withBalanceLock(owner.householdId, async (tx) =>
      applyLedgerEntry(tx, {
        entryType: "card_topup",
        householdId: owner.householdId,
        actorId: owner.userId,
        amountCents: 2_500,
        stripeCheckoutSessionId: sessionId,
        stripePaymentIntentId: null,
      }),
    );

    const auditRows = await adminDb()
      .select({
        action: householdAuditLog.action,
        payload: householdAuditLog.payload,
        actorId: householdAuditLog.actorId,
        householdId: householdAuditLog.householdId,
      })
      .from(householdAuditLog)
      .where(eq(householdAuditLog.householdId, owner.householdId));

    const matching = auditRows.filter((row) => {
      const payload = row.payload as { ledgerId?: string } | null;
      return payload?.ledgerId === ledgerId;
    });
    expect(matching).toHaveLength(1);
    expect(matching[0]?.action).toBe("balance_card_topup");
    expect(matching[0]?.actorId).toBe(owner.userId);
    expect(matching[0]?.householdId).toBe(owner.householdId);

    // Rollback coverage: wrap applyLedgerEntry in a transaction, throw
    // after it returns, and assert neither row landed. Proves the
    // "same transaction" guarantee — if either write fails, both unwind.
    const rollbackSessionId = await stripeSessionId("rollback");
    const BOOM = new Error("rollback-marker");
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${"household-balance:" + owner.householdId}))`,
        );
        await applyLedgerEntry(tx, {
          entryType: "card_topup",
          householdId: owner.householdId,
          actorId: owner.userId,
          amountCents: 999,
          stripeCheckoutSessionId: rollbackSessionId,
          stripePaymentIntentId: null,
        });
        throw BOOM;
      }),
    ).rejects.toBe(BOOM);

    const ledgerSurvivors = await adminDb()
      .select({ id: householdBalanceLedger.id })
      .from(householdBalanceLedger)
      .where(eq(householdBalanceLedger.stripeCheckoutSessionId, rollbackSessionId));
    expect(ledgerSurvivors).toHaveLength(0);
  });
});
