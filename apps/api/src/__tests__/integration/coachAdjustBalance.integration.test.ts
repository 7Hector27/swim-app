// POST /coach/households/:id/balance/adjust (ADR 036 Phase 6).
//
// Writes a `coach_adjustment` ledger row + its matching audit row in the
// same transaction. Signed amount; required reason; a negative that would
// take the balance below zero is rejected with 422 insufficient_balance.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import pino from "pino";
import { and, eq, sql } from "drizzle-orm";

import { createApp } from "../../app";
import {
  adminDb,
  closeAdminDb,
  createTestUser,
  seedHouseholdBalanceForTest,
  type TestUser,
} from "./helpers";
import {
  householdAuditLog,
  householdBalanceLedger,
  lessonEmailOutbox,
  profiles,
} from "../../db/schema";

const app = createApp(pino({ level: "silent" }));

let coach: TestUser;
let family: TestUser;

beforeAll(async () => {
  coach = await createTestUser("coach-adj-coach");
  family = await createTestUser("coach-adj-family");
  await adminDb().update(profiles).set({ role: "coach" }).where(eq(profiles.id, coach.userId));
});

afterAll(async () => {
  await adminDb().transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL session_replication_role = replica`);
    await tx.execute(
      sql`DELETE FROM household_balance_ledger WHERE household_id = ${family.householdId}::uuid`,
    );
  });
  // Phase 7: the adjust endpoint now enqueues a balance_adjusted outbox
  // row per call. Delete them before the household so the FK survives
  // teardown.
  await adminDb()
    .delete(lessonEmailOutbox)
    .where(
      and(
        eq(lessonEmailOutbox.householdId, family.householdId),
        eq(lessonEmailOutbox.event, "balance_adjusted"),
      ),
    );
  await Promise.all([coach.cleanup(), family.cleanup()]);
  await closeAdminDb();
});

describe("POST /coach/households/:id/balance/adjust", () => {
  it("writes a positive coach_adjustment ledger row + matching audit row in the same transaction", async () => {
    // Fresh ledger.
    await adminDb().transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = replica`);
      await tx.execute(
        sql`DELETE FROM household_balance_ledger WHERE household_id = ${family.householdId}::uuid`,
      );
    });
    const beforeAuditRows = await adminDb()
      .select({ id: householdAuditLog.id })
      .from(householdAuditLog)
      .where(
        and(
          eq(householdAuditLog.householdId, family.householdId),
          eq(householdAuditLog.action, "balance_coach_adjusted"),
        ),
      );

    const res = await request(app)
      .post(`/coach/households/${family.householdId}/balance/adjust`)
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send({ amountCents: 5_000, reason: "Thanks for the late cancel" });
    expect(res.status).toBe(201);
    expect(res.body.balanceCents).toBe(5_000);
    expect(typeof res.body.ledgerId).toBe("string");

    const ledgerRows = await adminDb()
      .select({
        id: householdBalanceLedger.id,
        entryType: householdBalanceLedger.entryType,
        amountCents: householdBalanceLedger.amountCents,
        actorId: householdBalanceLedger.actorId,
        reason: householdBalanceLedger.reason,
      })
      .from(householdBalanceLedger)
      .where(eq(householdBalanceLedger.id, res.body.ledgerId));
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows[0]!.entryType).toBe("coach_adjustment");
    expect(ledgerRows[0]!.amountCents).toBe(5_000);
    expect(ledgerRows[0]!.actorId).toBe(coach.userId);
    expect(ledgerRows[0]!.reason).toBe("Thanks for the late cancel");

    // One new audit row describing the adjustment (same tx as the ledger row).
    const afterAuditRows = await adminDb()
      .select({ id: householdAuditLog.id, actorId: householdAuditLog.actorId })
      .from(householdAuditLog)
      .where(
        and(
          eq(householdAuditLog.householdId, family.householdId),
          eq(householdAuditLog.action, "balance_coach_adjusted"),
        ),
      );
    expect(afterAuditRows).toHaveLength(beforeAuditRows.length + 1);
    expect(afterAuditRows[afterAuditRows.length - 1]!.actorId).toBe(coach.userId);
  });

  it("allows a negative adjustment that keeps balance non-negative", async () => {
    await adminDb().transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = replica`);
      await tx.execute(
        sql`DELETE FROM household_balance_ledger WHERE household_id = ${family.householdId}::uuid`,
      );
    });
    await seedHouseholdBalanceForTest({
      householdId: family.householdId,
      actorId: family.userId,
      amountCents: 10_000,
    });

    const res = await request(app)
      .post(`/coach/households/${family.householdId}/balance/adjust`)
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send({ amountCents: -3_000, reason: "Refund correction" });
    expect(res.status).toBe(201);
    expect(res.body.balanceCents).toBe(7_000);
  });

  it("rejects a negative adjustment that would drop balance below zero with 422 insufficient_balance", async () => {
    await adminDb().transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = replica`);
      await tx.execute(
        sql`DELETE FROM household_balance_ledger WHERE household_id = ${family.householdId}::uuid`,
      );
    });
    await seedHouseholdBalanceForTest({
      householdId: family.householdId,
      actorId: family.userId,
      amountCents: 1_000,
    });

    const res = await request(app)
      .post(`/coach/households/${family.householdId}/balance/adjust`)
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send({ amountCents: -5_000, reason: "Would overdraft" });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("insufficient_balance");
    expect(res.body.balanceCents).toBe(1_000);
    expect(res.body.priceCents).toBe(5_000);
    expect(res.body.shortfallCents).toBe(4_000);

    // Ledger unchanged — the rejected adjustment wrote nothing.
    const rows = await adminDb()
      .select({ sum: sql<string>`COALESCE(SUM(${householdBalanceLedger.amountCents}), 0)` })
      .from(householdBalanceLedger)
      .where(eq(householdBalanceLedger.householdId, family.householdId));
    expect(Number(rows[0]?.sum ?? "0")).toBe(1_000);
  });

  it("422s a zero amount (schema rejects at the validator)", async () => {
    const res = await request(app)
      .post(`/coach/households/${family.householdId}/balance/adjust`)
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send({ amountCents: 0, reason: "No-op" });
    expect(res.status).toBe(422);
  });

  it("422s an empty reason", async () => {
    const res = await request(app)
      .post(`/coach/households/${family.householdId}/balance/adjust`)
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send({ amountCents: 1_000, reason: "   " });
    expect(res.status).toBe(422);
  });

  it("returns 404 for a non-existent household id", async () => {
    const res = await request(app)
      .post("/coach/households/00000000-0000-0000-0000-000000000000/balance/adjust")
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send({ amountCents: 1_000, reason: "n/a" });
    expect(res.status).toBe(404);
  });

  it("returns 403 to a parent caller (coach-only route)", async () => {
    const res = await request(app)
      .post(`/coach/households/${family.householdId}/balance/adjust`)
      .set("Authorization", `Bearer ${family.accessToken}`)
      .send({ amountCents: 1_000, reason: "parent attempt" });
    expect(res.status).toBe(403);
  });

  it("Phase 7: enqueues a balance_adjusted outbox row in the same transaction as the ledger row", async () => {
    // Fresh ledger + fresh outbox slice.
    await adminDb().transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = replica`);
      await tx.execute(
        sql`DELETE FROM household_balance_ledger WHERE household_id = ${family.householdId}::uuid`,
      );
    });
    await adminDb()
      .delete(lessonEmailOutbox)
      .where(
        and(
          eq(lessonEmailOutbox.householdId, family.householdId),
          eq(lessonEmailOutbox.event, "balance_adjusted"),
        ),
      );

    const res = await request(app)
      .post(`/coach/households/${family.householdId}/balance/adjust`)
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send({ amountCents: 2_500, reason: "Birthday credit" });
    expect(res.status).toBe(201);

    const outboxRows = await adminDb()
      .select({
        householdId: lessonEmailOutbox.householdId,
        payload: lessonEmailOutbox.payload,
        recipientProfileIds: lessonEmailOutbox.recipientProfileIds,
      })
      .from(lessonEmailOutbox)
      .where(
        and(
          eq(lessonEmailOutbox.event, "balance_adjusted"),
          eq(lessonEmailOutbox.householdId, family.householdId),
        ),
      );
    expect(outboxRows).toHaveLength(1);
    const row = outboxRows[0]!;
    expect(row.householdId).toBe(family.householdId);
    expect(row.recipientProfileIds).toContain(family.userId);
    const payload = row.payload as {
      amountCents: number;
      newBalanceCents: number;
      reason: string;
    };
    expect(payload.amountCents).toBe(2_500);
    expect(payload.newBalanceCents).toBe(2_500);
    expect(payload.reason).toBe("Birthday credit");
  });

  it("Phase 7: a rejected overdraft adjustment writes NO balance_adjusted row (same tx rolls both back)", async () => {
    await adminDb().transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = replica`);
      await tx.execute(
        sql`DELETE FROM household_balance_ledger WHERE household_id = ${family.householdId}::uuid`,
      );
    });
    await adminDb()
      .delete(lessonEmailOutbox)
      .where(
        and(
          eq(lessonEmailOutbox.householdId, family.householdId),
          eq(lessonEmailOutbox.event, "balance_adjusted"),
        ),
      );
    await seedHouseholdBalanceForTest({
      householdId: family.householdId,
      actorId: family.userId,
      amountCents: 500,
    });

    const res = await request(app)
      .post(`/coach/households/${family.householdId}/balance/adjust`)
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send({ amountCents: -10_000, reason: "Would overdraft" });
    expect(res.status).toBe(422);

    const outboxRows = await adminDb()
      .select({ id: lessonEmailOutbox.id })
      .from(lessonEmailOutbox)
      .where(
        and(
          eq(lessonEmailOutbox.event, "balance_adjusted"),
          eq(lessonEmailOutbox.householdId, family.householdId),
        ),
      );
    expect(outboxRows).toHaveLength(0);
  });
});
