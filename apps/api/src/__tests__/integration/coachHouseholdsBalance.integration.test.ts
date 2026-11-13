// Coach-side household-balance endpoints (ADR 036 Phase 6).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import pino from "pino";
import { eq, sql } from "drizzle-orm";

import { createApp } from "../../app";
import {
  adminDb,
  closeAdminDb,
  createTestUser,
  seedHouseholdBalanceForTest,
  type TestUser,
} from "./helpers";
import { householdBalanceLedger, profiles } from "../../db/schema";

const app = createApp(pino({ level: "silent" }));

let coach: TestUser;
let familyA: TestUser;
let familyB: TestUser;
let familyC: TestUser;

beforeAll(async () => {
  coach = await createTestUser("coach-hb-coach");
  familyA = await createTestUser("coach-hb-fam-a");
  familyB = await createTestUser("coach-hb-fam-b");
  familyC = await createTestUser("coach-hb-fam-c");

  await adminDb().update(profiles).set({ role: "coach" }).where(eq(profiles.id, coach.userId));

  // Seed distinct balances so the list response is testable.
  await seedHouseholdBalanceForTest({
    householdId: familyA.householdId,
    actorId: familyA.userId,
    amountCents: 24_000,
  });
  await seedHouseholdBalanceForTest({
    householdId: familyB.householdId,
    actorId: familyB.userId,
    amountCents: 100,
  });
  // familyC stays at zero so the "no ledger rows" branch of lastActivityAt
  // is also exercised.
});

afterAll(async () => {
  // Append-only trigger → delete ledger rows under session_replication_role=replica.
  await adminDb().transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL session_replication_role = replica`);
    await tx.execute(sql`DELETE FROM household_balance_ledger WHERE household_id IN (
      ${familyA.householdId}::uuid, ${familyB.householdId}::uuid, ${familyC.householdId}::uuid
    )`);
  });
  await Promise.all([coach.cleanup(), familyA.cleanup(), familyB.cleanup(), familyC.cleanup()]);
  await closeAdminDb();
});

describe("GET /coach/households/balances", () => {
  it("returns every household with its balance, members, swimmer count, and last activity", async () => {
    const res = await request(app)
      .get("/coach/households/balances")
      .set("Authorization", `Bearer ${coach.accessToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    const rowA = res.body.find(
      (row: { householdId: string }) => row.householdId === familyA.householdId,
    );
    const rowB = res.body.find(
      (row: { householdId: string }) => row.householdId === familyB.householdId,
    );
    const rowC = res.body.find(
      (row: { householdId: string }) => row.householdId === familyC.householdId,
    );

    expect(rowA).toBeDefined();
    expect(rowA.balanceCents).toBe(24_000);
    expect(typeof rowA.lastActivityAt).toBe("string");
    expect(rowA.activeSwimmerCount).toBe(0);
    expect(Array.isArray(rowA.memberFullNames)).toBe(true);

    expect(rowB).toBeDefined();
    expect(rowB.balanceCents).toBe(100);
    expect(typeof rowB.lastActivityAt).toBe("string");

    // Family C has no ledger rows → balance 0, lastActivityAt null.
    expect(rowC).toBeDefined();
    expect(rowC.balanceCents).toBe(0);
    expect(rowC.lastActivityAt).toBeNull();
  });

  it("returns 403 to a non-coach parent caller", async () => {
    const res = await request(app)
      .get("/coach/households/balances")
      .set("Authorization", `Bearer ${familyA.accessToken}`);
    expect(res.status).toBe(403);
  });
});

describe("GET /coach/households/:id/balance", () => {
  it("returns a specific household's balance + approximate hours", async () => {
    const res = await request(app)
      .get(`/coach/households/${familyA.householdId}/balance`)
      .set("Authorization", `Bearer ${coach.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.balanceCents).toBe(24_000);
    expect(typeof res.body.approximatePrivateHours).toBe("number");
  });

  it("returns 404 for a non-existent household id", async () => {
    const res = await request(app)
      .get("/coach/households/00000000-0000-0000-0000-000000000000/balance")
      .set("Authorization", `Bearer ${coach.accessToken}`);
    expect(res.status).toBe(404);
  });
});

describe("GET /coach/households/:id/balance/history", () => {
  it("returns the household's history rows in reverse-chronological order with displayType + running balance", async () => {
    const res = await request(app)
      .get(`/coach/households/${familyA.householdId}/balance/history`)
      .set("Authorization", `Bearer ${coach.accessToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.entries)).toBe(true);
    expect(res.body.entries.length).toBeGreaterThanOrEqual(1);
    const newest = res.body.entries[0];
    expect(newest.entryType).toBe("coach_adjustment");
    expect(newest.amountCents).toBe(24_000);
    expect(newest.displayType).toMatch(/Jason adjusted/);
    expect(newest.runningBalanceCents).toBe(24_000);
  });

  it("paginates via opaque cursor when more than 50 rows exist", async () => {
    // Fresh state on family B for the pagination branch.
    await adminDb().transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL session_replication_role = replica`);
      await tx.execute(
        sql`DELETE FROM household_balance_ledger WHERE household_id = ${familyB.householdId}::uuid`,
      );
    });
    for (let i = 0; i < 55; i++) {
      await adminDb().insert(householdBalanceLedger).values({
        householdId: familyB.householdId,
        actorId: familyB.userId,
        entryType: "coach_adjustment",
        amountCents: 10,
        reason: `page-seed-${i}`,
      });
    }

    const page1 = await request(app)
      .get(`/coach/households/${familyB.householdId}/balance/history`)
      .set("Authorization", `Bearer ${coach.accessToken}`);
    expect(page1.status).toBe(200);
    expect(page1.body.entries).toHaveLength(50);
    expect(page1.body.nextCursor).not.toBeNull();

    const page2 = await request(app)
      .get(
        `/coach/households/${familyB.householdId}/balance/history?cursor=${encodeURIComponent(
          page1.body.nextCursor,
        )}`,
      )
      .set("Authorization", `Bearer ${coach.accessToken}`);
    expect(page2.status).toBe(200);
    expect(page2.body.entries.length).toBeGreaterThanOrEqual(1);
    expect(page2.body.nextCursor).toBeNull();
  });
});
