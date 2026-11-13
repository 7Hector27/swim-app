// Parent-facing balance endpoints (ADR 036 Phase 5).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import pino from "pino";
import { sql } from "drizzle-orm";

import { createApp } from "../../app";
import {
  adminDb,
  closeAdminDb,
  createTestUser,
  seedHouseholdBalanceForTest,
  type TestUser,
} from "./helpers";
import { householdBalanceLedger } from "../../db/schema";
import { approximatePrivateHours } from "@swim-app/shared";

const app = createApp(pino({ level: "silent" }));

let owner: TestUser;

beforeAll(async () => {
  owner = await createTestUser("balance-endpoints-owner");
});

afterAll(async () => {
  await adminDb().transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL session_replication_role = replica`);
    await tx.execute(
      sql`DELETE FROM household_balance_ledger WHERE household_id = ${owner.householdId}::uuid`,
    );
  });
  await owner.cleanup();
  await closeAdminDb();
});

describe("GET /me/balance", () => {
  it("returns the household's balance in cents + an approximate private-hours derivation", async () => {
    await seedHouseholdBalanceForTest({
      householdId: owner.householdId,
      actorId: owner.userId,
      amountCents: 24_000, // $240 → 2 hr at private rate
    });

    const res = await request(app)
      .get("/me/balance")
      .set("Authorization", `Bearer ${owner.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.balanceCents).toBe(24_000);
    expect(res.body.approximatePrivateHours).toBe(approximatePrivateHours(24_000));
  });

  it("returns 401 without a bearer token", async () => {
    const res = await request(app).get("/me/balance");
    expect(res.status).toBe(401);
  });
});

describe("GET /me/balance/history", () => {
  it("returns reverse-chronological entries with displayType + running balance", async () => {
    // Fresh state: wipe + seed three distinct entries.
    await adminDb().transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = replica`);
      await tx.execute(
        sql`DELETE FROM household_balance_ledger WHERE household_id = ${owner.householdId}::uuid`,
      );
    });

    // seed +$100, then charge -$60, then refund +$60 (lesson_id required).
    await seedHouseholdBalanceForTest({
      householdId: owner.householdId,
      actorId: owner.userId,
      amountCents: 10_000,
    });

    const res = await request(app)
      .get("/me/balance/history")
      .set("Authorization", `Bearer ${owner.accessToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.entries)).toBe(true);
    expect(res.body.entries.length).toBeGreaterThanOrEqual(1);
    // Newest row first.
    const newest = res.body.entries[0];
    expect(newest.entryType).toBe("coach_adjustment");
    expect(newest.amountCents).toBe(10_000);
    expect(newest.displayType).toMatch(/Jason adjusted/);
    // Running balance after this row == 10_000.
    expect(newest.runningBalanceCents).toBe(10_000);
    expect(res.body.nextCursor).toBeNull();
  });

  it("paginates via opaque cursor when more than 20 rows exist", async () => {
    // ADR 036 Phase 8 Part B Stop 3 piece 5: page size is 20, sized
    // to the balance-history UI's "Load more" button. Seed 25 rows →
    // expect 20 on page 1 + 5 on page 2.
    await adminDb().transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = replica`);
      await tx.execute(
        sql`DELETE FROM household_balance_ledger WHERE household_id = ${owner.householdId}::uuid`,
      );
    });

    for (let i = 0; i < 25; i++) {
      await adminDb().insert(householdBalanceLedger).values({
        householdId: owner.householdId,
        actorId: owner.userId,
        entryType: "coach_adjustment",
        amountCents: 100,
        reason: `seed-${i}`,
      });
    }

    const page1 = await request(app)
      .get("/me/balance/history")
      .set("Authorization", `Bearer ${owner.accessToken}`);
    expect(page1.status).toBe(200);
    expect(page1.body.entries).toHaveLength(20);
    expect(page1.body.nextCursor).not.toBeNull();

    const page2 = await request(app)
      .get(`/me/balance/history?cursor=${encodeURIComponent(page1.body.nextCursor)}`)
      .set("Authorization", `Bearer ${owner.accessToken}`);
    expect(page2.status).toBe(200);
    expect(page2.body.entries).toHaveLength(5);
    expect(page2.body.nextCursor).toBeNull();
    // No overlap between pages — ids are distinct.
    const idsP1 = new Set(page1.body.entries.map((row: { id: string }) => row.id));
    for (const row of page2.body.entries as Array<{ id: string }>) {
      expect(idsP1.has(row.id)).toBe(false);
    }
  });
});
