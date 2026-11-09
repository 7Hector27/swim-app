// Household balance ledger service (ADR 036 Phase 2).
//
// The ledger is the authoritative record of every dollar in and out of a
// household's prepaid balance. All writes go through this module so three
// invariants hold:
//
//   1. Every ledger row lands in the same transaction as its matching
//      `household_audit_log` row (CLAUDE.md audit-log rule).
//   2. Every read-then-write of balance runs under the per-household
//      advisory lock, so two concurrent transactions on one household
//      serialize and can't both decide the same dollars are available
//      (ADR 036 §1, concurrency).
//   3. Rows are append-only. A DB trigger (migration 0077) rejects every
//      UPDATE and DELETE; this module only inserts.
//
// The service accepts an existing transaction for inserts so callers can
// bundle balance movements with the state change they describe (lesson
// insert, Stripe webhook commit, etc.). `withBalanceLock` opens the
// transaction when the caller has nothing else to bundle.

import { and, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { db } from "../../db/client";
import * as schema from "../../db/schema";
import { householdAuditLog, householdBalanceLedger } from "../../db/schema";

type Db = PostgresJsDatabase<typeof schema>;

// Discriminated union of every ledger entry the service accepts. Shape
// matches the per-entry-type CHECK constraints on `household_balance_ledger`
// so a caller that satisfies the type also satisfies the DB. `actorId` is
// required on every write — the cron-driven expired-pending refund path
// passes the lesson's original `requestedBy` as the actor so the audit
// log's NOT NULL actor_id stays happy and the audit entry still names a
// meaningful party.
export type LedgerEntryInput =
  | {
      entryType: "card_topup";
      householdId: string;
      actorId: string;
      amountCents: number;
      stripeCheckoutSessionId: string;
      stripePaymentIntentId: string | null;
    }
  | {
      entryType: "package_purchase";
      householdId: string;
      actorId: string;
      amountCents: number;
      stripeCheckoutSessionId: string;
      stripePaymentIntentId: string | null;
    }
  | {
      entryType: "package_bonus";
      householdId: string;
      actorId: string;
      amountCents: number;
      stripeCheckoutSessionId: string;
      stripePaymentIntentId: string | null;
    }
  | {
      entryType: "lesson_charge";
      householdId: string;
      actorId: string;
      amountCents: number;
      lessonId: string;
    }
  | {
      entryType: "refund_to_balance";
      householdId: string;
      actorId: string;
      amountCents: number;
      lessonId: string;
    }
  | {
      entryType: "coach_adjustment";
      householdId: string;
      actorId: string;
      amountCents: number;
      reason: string;
    }
  | {
      entryType: "free_lesson";
      householdId: string;
      actorId: string;
      lessonId: string;
    };

// One audit action per entry type (ADR 036 §1). `package_bonus` shares the
// action with `package_purchase` — both audit rows describe the same
// parent-initiated package buy.
const AUDIT_ACTIONS: Record<LedgerEntryInput["entryType"], string> = {
  card_topup: "balance_card_topup",
  package_purchase: "balance_package_purchased",
  package_bonus: "balance_package_purchased",
  lesson_charge: "balance_lesson_charged",
  refund_to_balance: "balance_lesson_refunded",
  coach_adjustment: "balance_coach_adjusted",
  free_lesson: "balance_free_lesson",
};

/**
 * Sum the household's live ledger rows. Returns integer cents. Safe to call
 * outside a transaction for display (`GET /me/balance`); callers that use
 * the number to decide whether a write is allowed must call it inside the
 * balance lock (`withBalanceLock` → `getHouseholdBalance(id, tx)`), or the
 * read is racy.
 */
export async function getHouseholdBalance(
  householdId: string,
  dbOrTx: Db = db,
): Promise<number> {
  const rows = await dbOrTx
    .select({
      sum: sql<string>`COALESCE(SUM(${householdBalanceLedger.amountCents}), 0)`,
    })
    .from(householdBalanceLedger)
    .where(eq(householdBalanceLedger.householdId, householdId));
  return Number(rows[0]?.sum ?? "0");
}

/**
 * Insert one ledger row and its matching audit row in the given transaction.
 * The caller holds the advisory lock (via `withBalanceLock` or the enclosing
 * transaction that already took the lock) so the read-check-write cycle is
 * atomic from the perspective of any other household-balance writer.
 *
 * Returns the new ledger row's id. The audit row's payload carries this id
 * so audit traces back to the exact ledger entry it describes.
 */
export async function applyLedgerEntry(
  tx: Db,
  input: LedgerEntryInput,
): Promise<string> {
  const amountCents = input.entryType === "free_lesson" ? 0 : input.amountCents;

  const lessonId =
    input.entryType === "lesson_charge"
      || input.entryType === "refund_to_balance"
      || input.entryType === "free_lesson"
      ? input.lessonId
      : null;

  const stripeCheckoutSessionId =
    input.entryType === "card_topup"
      || input.entryType === "package_purchase"
      || input.entryType === "package_bonus"
      ? input.stripeCheckoutSessionId
      : null;

  const stripePaymentIntentId =
    input.entryType === "card_topup"
      || input.entryType === "package_purchase"
      || input.entryType === "package_bonus"
      ? input.stripePaymentIntentId
      : null;

  const reason = input.entryType === "coach_adjustment" ? input.reason : null;

  const insertedRows = await tx
    .insert(householdBalanceLedger)
    .values({
      householdId: input.householdId,
      entryType: input.entryType,
      amountCents,
      lessonId,
      stripeCheckoutSessionId,
      stripePaymentIntentId,
      actorId: input.actorId,
      reason,
    })
    .returning({ id: householdBalanceLedger.id });

  const ledgerId = insertedRows[0]?.id;
  if (!ledgerId) {
    // `returning` with a successful insert always yields one row; the undefined
    // branch is a type-narrowing guard, not an expected runtime state.
    throw new Error("applyLedgerEntry: ledger insert returned no row");
  }

  const auditPayload: Record<string, unknown> = {
    ledgerId,
    entryType: input.entryType,
    amountCents,
  };
  if (lessonId !== null) {
    auditPayload["lessonId"] = lessonId;
  }
  if (stripeCheckoutSessionId !== null) {
    auditPayload["stripeSessionId"] = stripeCheckoutSessionId;
  }
  if (reason !== null) {
    auditPayload["reason"] = reason;
  }

  await tx.insert(householdAuditLog).values({
    householdId: input.householdId,
    actorId: input.actorId,
    action: AUDIT_ACTIONS[input.entryType],
    payload: auditPayload,
  });

  return ledgerId;
}

/**
 * Open a transaction, acquire the per-household balance advisory lock, and
 * run `fn` inside it. Two concurrent calls with the same `householdId` run
 * serially; calls with different ids do not block each other.
 *
 * The lock namespace is independent of the lesson-day lock (ADR 029). When a
 * flow needs both (e.g. parent booking under Phase 4), the day lock is taken
 * first, then this one — one consistent acquire order across the codebase.
 */
export async function withBalanceLock<T>(
  householdId: string,
  fn: (tx: Db) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${"household-balance:" + householdId}))`,
    );
    return fn(tx);
  });
}

export type RefundLessonChargeResult =
  | { refunded: false; reason: "no_charge" | "already_refunded" }
  | { refunded: true; amountCents: number; ledgerId: string };

/**
 * Read the lesson's `lesson_charge` row and, if present, write the inverse
 * `refund_to_balance` row plus audit. Refunds are idempotent per lesson: a
 * second call for the same lesson returns `{ refunded: false, reason:
 * "already_refunded" }` without writing a second row. The DB enforces the
 * invariant via the `balance_ledger_refund_lesson_uq` partial unique index,
 * so concurrent refund paths (e.g. a cron retry racing with a human action)
 * also collapse to a single refund row — one caller wins the insert, the
 * other's `ON CONFLICT DO NOTHING` returns zero rows and reports the no-op.
 * The DB — not service discipline — is the ultimate gatekeeper.
 *
 * Refund amount is read from the stored charge — never recomputed from the
 * current rate card — so rate changes between booking and refund don't
 * leak either direction.
 */
export async function refundLessonCharge(
  tx: Db,
  args: { householdId: string; lessonId: string; actorId: string },
): Promise<RefundLessonChargeResult> {
  const chargeRows = await tx
    .select({ amountCents: householdBalanceLedger.amountCents })
    .from(householdBalanceLedger)
    .where(
      and(
        eq(householdBalanceLedger.lessonId, args.lessonId),
        eq(householdBalanceLedger.entryType, "lesson_charge"),
      ),
    )
    .limit(1);

  const chargeAmount = chargeRows[0]?.amountCents;
  if (chargeAmount === undefined) {
    return { refunded: false, reason: "no_charge" };
  }

  // Charge amounts are stored negative; flip the sign to produce the refund.
  const refundAmount = -chargeAmount;

  // Insert directly with ON CONFLICT DO NOTHING against the partial unique
  // index that scopes "one refund per lesson." We cannot use the shared
  // applyLedgerEntry helper here because a unique-violation in Postgres
  // aborts the enclosing transaction — a try/catch would leave the tx in
  // the aborted state, breaking the audit insert and anything the caller
  // wanted to do after. ON CONFLICT DO NOTHING keeps the tx healthy.
  const insertedRows = await tx
    .insert(householdBalanceLedger)
    .values({
      householdId: args.householdId,
      entryType: "refund_to_balance",
      amountCents: refundAmount,
      lessonId: args.lessonId,
      actorId: args.actorId,
    })
    .onConflictDoNothing({
      target: householdBalanceLedger.lessonId,
      // The partial unique index is predicated on entry_type; Postgres
      // requires the inference predicate to match the index predicate
      // exactly before it will use the partial index for the conflict
      // check.
      where: sql`entry_type = 'refund_to_balance'`,
    })
    .returning({ id: householdBalanceLedger.id });

  const ledgerId = insertedRows[0]?.id;
  if (!ledgerId) {
    return { refunded: false, reason: "already_refunded" };
  }

  await tx.insert(householdAuditLog).values({
    householdId: args.householdId,
    actorId: args.actorId,
    action: AUDIT_ACTIONS["refund_to_balance"],
    payload: {
      ledgerId,
      entryType: "refund_to_balance",
      amountCents: refundAmount,
      lessonId: args.lessonId,
    },
  });

  return { refunded: true, amountCents: refundAmount, ledgerId };
}
