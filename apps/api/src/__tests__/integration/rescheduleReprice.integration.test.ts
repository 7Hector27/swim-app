// Duration-change reprice on reschedule (ADR 036 §2, revised).
//
// PATCH /lessons/:id can change duration. When it does, the handler
// refunds the current lesson_charge and writes a new one at the new
// price, all in one transaction. If balance after the refund can't cover
// the new price, the whole reschedule fails with 422 insufficient_balance
// and nothing changes. Free lessons stay free (no ledger movement) and
// time-only reschedules touch no money.
//
// The one-refund-per-charge DB index (migration 0080) lets a lesson be
// charged → refunded (reprice) → re-charged → refunded (cancel) without
// colliding — the second refund offsets a different charge row.

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
  settleAndCleanupCoachNotificationsForHousehold,
  type TestUser,
} from "./helpers";
import {
  availabilitySeasons,
  householdBalanceLedger,
  lessonEmailOutbox,
  lessonLocations,
  lessonSwimmers,
  lessons,
  profiles,
  swimmers,
} from "../../db/schema";
import { getHouseholdBalance } from "../../services/balance";
import { priceForLesson } from "@swim-app/shared";

const app = createApp(pino({ level: "silent" }));

let coach: TestUser;
let owner: TestUser;
let swimmerId: string;
let locationId: string;

async function makeCoach(userId: string): Promise<void> {
  await adminDb().update(profiles).set({ role: "coach" }).where(eq(profiles.id, userId));
}

async function withAllDaysEnabled<T>(fn: () => Promise<T>): Promise<T> {
  const seasons = await adminDb().select().from(availabilitySeasons);
  const originals = seasons.map((season) => ({ id: season.id, teachesDays: season.teachesDays }));
  for (const season of seasons) {
    await adminDb()
      .update(availabilitySeasons)
      .set({ teachesDays: [1, 2, 3, 4, 5, 6, 7] })
      .where(eq(availabilitySeasons.id, season.id));
  }
  try {
    return await fn();
  } finally {
    for (const original of originals) {
      await adminDb()
        .update(availabilitySeasons)
        .set({ teachesDays: original.teachesDays })
        .where(eq(availabilitySeasons.id, original.id));
    }
  }
}

async function findAvailableSlots(
  durationMinutes: 30 | 45 | 60,
  howMany: number,
): Promise<string[]> {
  const found: string[] = [];
  for (let weekOffset = 0; weekOffset < 20 && found.length < howMany; weekOffset++) {
    const weekDate = new Date(Date.now() + weekOffset * 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const res = await request(app)
      .get("/lessons/available-range")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .query({
        view: "week",
        date: weekDate,
        durationMinutes: String(durationMinutes),
        locationId,
      });
    if (res.status !== 200) continue;
    const body = res.body as {
      days: Array<{ slots: Array<{ startsAt: string; state: string }> }>;
    };
    let tookFromThisWeek = false;
    for (const day of body.days) {
      if (tookFromThisWeek) break;
      for (const slot of day.slots) {
        if (slot.state === "available") {
          found.push(slot.startsAt);
          tookFromThisWeek = true;
          break;
        }
      }
    }
  }
  if (found.length < howMany) {
    throw new Error(`only found ${found.length} slots, needed ${howMany}`);
  }
  return found;
}

async function wipeArtifacts(): Promise<void> {
  await settleAndCleanupCoachNotificationsForHousehold(owner.householdId);
  const householdLessons = await adminDb()
    .select({ id: lessons.id })
    .from(lessons)
    .where(eq(lessons.householdId, owner.householdId));
  const ids = householdLessons.map((row) => row.id);
  if (ids.length > 0) {
    for (const id of ids) {
      await adminDb().delete(lessonEmailOutbox).where(eq(lessonEmailOutbox.lessonId, id));
      await adminDb().delete(lessonSwimmers).where(eq(lessonSwimmers.lessonId, id));
    }
    await adminDb().delete(lessons).where(eq(lessons.householdId, owner.householdId));
  }
  await adminDb().transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL session_replication_role = replica`);
    await tx.execute(
      sql`DELETE FROM household_balance_ledger WHERE household_id = ${owner.householdId}::uuid`,
    );
  });
}

beforeAll(async () => {
  coach = await createTestUser("reprice-coach");
  await makeCoach(coach.userId);
  owner = await createTestUser("reprice-owner");

  const locs = await adminDb()
    .select({ id: lessonLocations.id })
    .from(lessonLocations)
    .where(eq(lessonLocations.isActive, true))
    .limit(1);
  const found = locs[0]?.id;
  if (!found) throw new Error("no active location in test stack");
  locationId = found;

  const swimmerRows = await adminDb()
    .insert(swimmers)
    .values({
      firstName: "Reprice",
      lastName: "Swimmer",
      birthDate: "2016-01-01",
      sex: "male",
      isPublic: false,
      householdId: owner.householdId,
    })
    .returning({ id: swimmers.id });
  const sid = swimmerRows[0]?.id;
  if (!sid) throw new Error("failed to seed swimmer");
  swimmerId = sid;
});

afterAll(async () => {
  await wipeArtifacts();
  await owner.cleanup();
  await coach.cleanup();
  await closeAdminDb();
});

async function bookOneAsOwner(
  durationMinutes: 30 | 45 | 60,
): Promise<{ lessonId: string; price: number }> {
  const price = priceForLesson(durationMinutes, 1);
  await seedHouseholdBalanceForTest({
    householdId: owner.householdId,
    actorId: owner.userId,
    amountCents: price,
  });
  const slots = await findAvailableSlots(durationMinutes, 1);
  const slot = slots[0]!;
  const res = await request(app)
    .post("/lessons")
    .set("Authorization", `Bearer ${owner.accessToken}`)
    .send({ startsAt: slot, durationMinutes, locationId, swimmerIds: [swimmerId] });
  if (res.status !== 201) {
    throw new Error(`booking failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return { lessonId: res.body.id, price };
}

describe("PATCH /lessons/:id — duration-change reprice (ADR 036 §2)", () => {
  it("longer duration with enough balance refunds the old charge and writes a new one at the new price", async () => {
    await wipeArtifacts();
    await withAllDaysEnabled(async () => {
      const oldPrice = priceForLesson(30, 1);
      const newPrice = priceForLesson(60, 1);
      // Enough balance to cover: oldPrice (consumed) + (newPrice - oldPrice) delta.
      await seedHouseholdBalanceForTest({
        householdId: owner.householdId,
        actorId: owner.userId,
        amountCents: newPrice, // after refund of oldPrice we'll have newPrice + 0 available
      });
      const [slot] = await findAvailableSlots(30, 1);
      const bookRes = await request(app)
        .post("/lessons")
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({ startsAt: slot, durationMinutes: 30, locationId, swimmerIds: [swimmerId] });
      expect(bookRes.status).toBe(201);
      const lessonId = bookRes.body.id as string;
      // Balance after initial book: newPrice - oldPrice (we seeded newPrice, charged oldPrice).
      expect(await getHouseholdBalance(owner.householdId)).toBe(newPrice - oldPrice);

      const patchRes = await request(app)
        .patch(`/lessons/${lessonId}`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({ durationMinutes: 60 });
      expect(patchRes.status).toBe(200);
      expect(patchRes.body.durationMinutes).toBe(60);

      // Expect ledger to show: original charge (-oldPrice), refund (+oldPrice),
      // new charge (-newPrice). Net balance = 0.
      const ledgerRows = await adminDb()
        .select({
          entryType: householdBalanceLedger.entryType,
          amountCents: householdBalanceLedger.amountCents,
          refundOfLedgerId: householdBalanceLedger.refundOfLedgerId,
          id: householdBalanceLedger.id,
        })
        .from(householdBalanceLedger)
        .where(eq(householdBalanceLedger.lessonId, lessonId));
      expect(ledgerRows).toHaveLength(3);
      const charges = ledgerRows.filter((row) => row.entryType === "lesson_charge");
      const refunds = ledgerRows.filter((row) => row.entryType === "refund_to_balance");
      expect(charges).toHaveLength(2);
      expect(refunds).toHaveLength(1);
      const chargeAmounts = charges.map((row) => row.amountCents).sort((a, b) => a - b);
      expect(chargeAmounts).toEqual([-newPrice, -oldPrice]);
      expect(refunds[0]?.amountCents).toBe(oldPrice);
      // Refund points at one of the charges (the original).
      const originalCharge = charges.find((row) => row.amountCents === -oldPrice);
      expect(originalCharge).toBeDefined();
      expect(refunds[0]?.refundOfLedgerId).toBe(originalCharge!.id);

      expect(await getHouseholdBalance(owner.householdId)).toBe(0);
    });
  });

  it("longer duration with insufficient balance: 422 insufficient_balance, nothing changes", async () => {
    await wipeArtifacts();
    await withAllDaysEnabled(async () => {
      const oldPrice = priceForLesson(30, 1);
      const newPrice = priceForLesson(60, 1);
      // Seed just enough to cover the initial booking — no headroom for the
      // reprice delta.
      await seedHouseholdBalanceForTest({
        householdId: owner.householdId,
        actorId: owner.userId,
        amountCents: oldPrice,
      });
      const [slot] = await findAvailableSlots(30, 1);
      const bookRes = await request(app)
        .post("/lessons")
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({ startsAt: slot, durationMinutes: 30, locationId, swimmerIds: [swimmerId] });
      expect(bookRes.status).toBe(201);
      const lessonId = bookRes.body.id as string;
      expect(await getHouseholdBalance(owner.householdId)).toBe(0);

      const patchRes = await request(app)
        .patch(`/lessons/${lessonId}`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({ durationMinutes: 60 });
      expect(patchRes.status).toBe(422);
      expect(patchRes.body.error).toBe("insufficient_balance");
      // available-after-refund (= 0 + oldPrice = oldPrice) < newPrice.
      expect(patchRes.body.shortfallCents).toBe(newPrice - oldPrice);

      // Lesson unchanged (still 30 min).
      const lessonRow = await adminDb()
        .select({ durationMinutes: lessons.durationMinutes })
        .from(lessons)
        .where(eq(lessons.id, lessonId))
        .limit(1);
      expect(lessonRow[0]?.durationMinutes).toBe(30);

      // Ledger unchanged: still just one lesson_charge of -oldPrice, no refund.
      const ledgerRows = await adminDb()
        .select({
          entryType: householdBalanceLedger.entryType,
          amountCents: householdBalanceLedger.amountCents,
        })
        .from(householdBalanceLedger)
        .where(eq(householdBalanceLedger.lessonId, lessonId));
      expect(ledgerRows).toHaveLength(1);
      expect(ledgerRows[0]?.entryType).toBe("lesson_charge");
      expect(ledgerRows[0]?.amountCents).toBe(-oldPrice);
      expect(await getHouseholdBalance(owner.householdId)).toBe(0);
    });
  });

  it("shorter duration nets a refund of the difference", async () => {
    await wipeArtifacts();
    await withAllDaysEnabled(async () => {
      const oldPrice = priceForLesson(60, 1);
      const newPrice = priceForLesson(30, 1);
      await seedHouseholdBalanceForTest({
        householdId: owner.householdId,
        actorId: owner.userId,
        amountCents: oldPrice,
      });
      const [slot] = await findAvailableSlots(60, 1);
      const bookRes = await request(app)
        .post("/lessons")
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({ startsAt: slot, durationMinutes: 60, locationId, swimmerIds: [swimmerId] });
      expect(bookRes.status).toBe(201);
      const lessonId = bookRes.body.id as string;

      const patchRes = await request(app)
        .patch(`/lessons/${lessonId}`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({ durationMinutes: 30 });
      expect(patchRes.status).toBe(200);

      // Net change in balance = oldPrice refund − newPrice charge = (old − new).
      expect(await getHouseholdBalance(owner.householdId)).toBe(oldPrice - newPrice);
    });
  });

  it("free lesson stays free: duration change writes no ledger rows", async () => {
    await wipeArtifacts();
    await withAllDaysEnabled(async () => {
      const [slot] = await findAvailableSlots(30, 1);
      const bookRes = await request(app)
        .post("/coach/lessons")
        .set("Authorization", `Bearer ${coach.accessToken}`)
        .send({
          householdId: owner.householdId,
          swimmerIds: [swimmerId],
          locationId,
          startsAt: slot,
          durationMinutes: 30,
          chargeType: "free",
        });
      expect(bookRes.status).toBe(201);
      const lessonId = bookRes.body.id as string;

      // Only the free_lesson marker exists.
      const ledgerBefore = await adminDb()
        .select({ entryType: householdBalanceLedger.entryType })
        .from(householdBalanceLedger)
        .where(eq(householdBalanceLedger.lessonId, lessonId));
      expect(ledgerBefore).toHaveLength(1);
      expect(ledgerBefore[0]?.entryType).toBe("free_lesson");

      const patchRes = await request(app)
        .patch(`/lessons/${lessonId}`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({ durationMinutes: 60 });
      expect(patchRes.status).toBe(200);
      expect(patchRes.body.durationMinutes).toBe(60);

      // Still only the free_lesson marker — no reprice money moved.
      const ledgerAfter = await adminDb()
        .select({ entryType: householdBalanceLedger.entryType })
        .from(householdBalanceLedger)
        .where(eq(householdBalanceLedger.lessonId, lessonId));
      expect(ledgerAfter).toHaveLength(1);
      expect(ledgerAfter[0]?.entryType).toBe("free_lesson");
      expect(await getHouseholdBalance(owner.householdId)).toBe(0);
    });
  });

  it("time-only reschedule writes no ledger rows", async () => {
    await wipeArtifacts();
    await withAllDaysEnabled(async () => {
      const { lessonId } = await bookOneAsOwner(30);

      const beforeCount = (
        await adminDb()
          .select({ id: householdBalanceLedger.id })
          .from(householdBalanceLedger)
          .where(eq(householdBalanceLedger.lessonId, lessonId))
      ).length;

      // Pick a new slot at the same duration.
      const slots = await findAvailableSlots(30, 5);
      // Find one that isn't the current slot.
      const currentStart = (
        await adminDb()
          .select({ startsAt: lessons.startsAt })
          .from(lessons)
          .where(eq(lessons.id, lessonId))
          .limit(1)
      )[0]?.startsAt?.toISOString();
      const newSlot = slots.find((s) => s !== currentStart);
      if (!newSlot) throw new Error("no alternative slot found");

      const patchRes = await request(app)
        .patch(`/lessons/${lessonId}`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({ startsAt: newSlot });
      expect(patchRes.status).toBe(200);

      // Ledger row count unchanged.
      const afterCount = (
        await adminDb()
          .select({ id: householdBalanceLedger.id })
          .from(householdBalanceLedger)
          .where(eq(householdBalanceLedger.lessonId, lessonId))
      ).length;
      expect(afterCount).toBe(beforeCount);
    });
  });

  it("duration change then cancel refunds the CURRENT charge, not the already-refunded one", async () => {
    await wipeArtifacts();
    await withAllDaysEnabled(async () => {
      const oldPrice = priceForLesson(30, 1);
      const newPrice = priceForLesson(60, 1);
      await seedHouseholdBalanceForTest({
        householdId: owner.householdId,
        actorId: owner.userId,
        amountCents: newPrice,
      });
      const [slot] = await findAvailableSlots(30, 1);
      const bookRes = await request(app)
        .post("/lessons")
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({ startsAt: slot, durationMinutes: 30, locationId, swimmerIds: [swimmerId] });
      expect(bookRes.status).toBe(201);
      const lessonId = bookRes.body.id as string;

      // Reprice to 60 min.
      const patchRes = await request(app)
        .patch(`/lessons/${lessonId}`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({ durationMinutes: 60 });
      expect(patchRes.status).toBe(200);
      const balanceAfterReprice = await getHouseholdBalance(owner.householdId);
      expect(balanceAfterReprice).toBe(0);

      // Cancel — must refund the new (60-min) charge, not the old one.
      const cancelRes = await request(app)
        .delete(`/lessons/${lessonId}`)
        .set("Authorization", `Bearer ${owner.accessToken}`);
      // ADR 036 Phase 8 Part B Stop 3 piece 4: cancel returns 200 with
      // the refund + new balance.
      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.refundAmountCents).toBe(newPrice);

      expect(await getHouseholdBalance(owner.householdId)).toBe(newPrice);

      // Ledger should now be: 2 charges (-oldPrice, -newPrice) + 2 refunds
      // (+oldPrice, +newPrice). Net zero, except seeded balance of newPrice.
      const ledgerRows = await adminDb()
        .select({
          entryType: householdBalanceLedger.entryType,
          amountCents: householdBalanceLedger.amountCents,
        })
        .from(householdBalanceLedger)
        .where(
          and(
            eq(householdBalanceLedger.lessonId, lessonId),
          ),
        );
      const chargeTotal = ledgerRows
        .filter((row) => row.entryType === "lesson_charge")
        .reduce((sum, row) => sum + row.amountCents, 0);
      const refundTotal = ledgerRows
        .filter((row) => row.entryType === "refund_to_balance")
        .reduce((sum, row) => sum + row.amountCents, 0);
      expect(chargeTotal).toBe(-(oldPrice + newPrice));
      expect(refundTotal).toBe(oldPrice + newPrice);
    });
  });
});
