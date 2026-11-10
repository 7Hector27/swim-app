// No-show undo re-charge (ADR 036 Phase 4).
//
// A no-show refunds the charge in full. Undoing a no-show re-charges the
// lesson at the CURRENT price (duration × swimmer count via the pricing
// module). If the family's balance can't cover the re-charge, the undo
// returns 409 insufficient_balance; the coach can retry with
// chargeType='free' to land the undo as a comp.
//
// A lesson that was originally free (no-show refunded nothing) stays free
// on undo regardless of chargeType.
//
// Undoing twice can't double-charge: the status check (lesson_not_no_show
// on a lesson that's already been undone) blocks the second call before
// the ledger is touched.

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

async function findFirstAvailableSlot(durationMinutes: 30 | 45 | 60): Promise<string> {
  for (let weekOffset = 0; weekOffset < 10; weekOffset++) {
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
    for (const day of body.days) {
      for (const slot of day.slots) {
        if (slot.state === "available") return slot.startsAt;
      }
    }
  }
  throw new Error("No available slot within 10 weeks");
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
  coach = await createTestUser("noshow-undo-coach");
  await makeCoach(coach.userId);
  owner = await createTestUser("noshow-undo-owner");

  const locs = await adminDb()
    .select({ id: lessonLocations.id })
    .from(lessonLocations)
    .where(eq(lessonLocations.isActive, true))
    .limit(1);
  const found = locs[0]?.id;
  if (!found) throw new Error("no active location");
  locationId = found;

  const swimmerRows = await adminDb()
    .insert(swimmers)
    .values({
      firstName: "NoShowUndo",
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

async function bookAndNoShow(): Promise<{ lessonId: string; price: number }> {
  const price = priceForLesson(30, 1);
  await seedHouseholdBalanceForTest({
    householdId: owner.householdId,
    actorId: owner.userId,
    amountCents: price,
  });
  const slot = await findFirstAvailableSlot(30);
  const bookRes = await request(app)
    .post("/lessons")
    .set("Authorization", `Bearer ${owner.accessToken}`)
    .send({ startsAt: slot, durationMinutes: 30, locationId, swimmerIds: [swimmerId] });
  if (bookRes.status !== 201) throw new Error(`book failed: ${bookRes.status}`);
  const lessonId = bookRes.body.id as string;

  // Flip into approved + past so the no-show mark is accepted.
  await adminDb()
    .update(lessons)
    .set({
      status: "approved",
      startsAt: new Date(Date.now() - 60 * 60 * 1000),
    })
    .where(eq(lessons.id, lessonId));

  const noShowRes = await request(app)
    .patch(`/coach/lessons/${lessonId}/no-show`)
    .set("Authorization", `Bearer ${coach.accessToken}`)
    .send({});
  if (noShowRes.status !== 200) {
    throw new Error(`no-show failed: ${noShowRes.status} ${JSON.stringify(noShowRes.body)}`);
  }
  return { lessonId, price };
}

describe("PATCH /coach/lessons/:id/no-show/undo — re-charge (ADR 036 Phase 4)", () => {
  it("re-charges the lesson at the current price when chargeType defaults to 'balance' and the family can cover it", async () => {
    await wipeArtifacts();
    await withAllDaysEnabled(async () => {
      const { lessonId, price } = await bookAndNoShow();
      // After no-show the balance should be back to `price` (refund).
      expect(await getHouseholdBalance(owner.householdId)).toBe(price);

      const res = await request(app)
        .patch(`/coach/lessons/${lessonId}/no-show/undo`)
        .set("Authorization", `Bearer ${coach.accessToken}`)
        .send({});
      expect(res.status).toBe(200);

      // Ledger has 2 charges (-price, -price) and 1 refund (+price).
      const ledgerRows = await adminDb()
        .select({
          entryType: householdBalanceLedger.entryType,
          amountCents: householdBalanceLedger.amountCents,
          actorId: householdBalanceLedger.actorId,
        })
        .from(householdBalanceLedger)
        .where(eq(householdBalanceLedger.lessonId, lessonId));
      const charges = ledgerRows.filter((row) => row.entryType === "lesson_charge");
      const refunds = ledgerRows.filter((row) => row.entryType === "refund_to_balance");
      expect(charges).toHaveLength(2);
      expect(refunds).toHaveLength(1);
      expect(charges[0]?.amountCents).toBe(-price);
      expect(charges[1]?.amountCents).toBe(-price);
      // The re-charge is written by the coach.
      const recharge = charges.find((row) => row.actorId === coach.userId);
      expect(recharge).toBeDefined();

      // Balance back to 0 (seed `price` − first charge − refund + first refund − re-charge).
      expect(await getHouseholdBalance(owner.householdId)).toBe(0);
    });
  });

  it("returns 409 insufficient_balance when the family can't cover the re-charge; no new lesson_charge is written and status stays no_show", async () => {
    await wipeArtifacts();
    await withAllDaysEnabled(async () => {
      const { lessonId, price } = await bookAndNoShow();
      // Drain the refunded balance via a coach_adjustment so the re-charge
      // can't fit. (Simulate the parent spending the refund elsewhere.)
      await adminDb().insert(householdBalanceLedger).values({
        householdId: owner.householdId,
        actorId: coach.userId,
        entryType: "coach_adjustment",
        amountCents: -price, // spend $price from balance
        reason: "test: drain balance before undo",
      });
      expect(await getHouseholdBalance(owner.householdId)).toBe(0);

      const res = await request(app)
        .patch(`/coach/lessons/${lessonId}/no-show/undo`)
        .set("Authorization", `Bearer ${coach.accessToken}`)
        .send({});
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("insufficient_balance");
      expect(res.body.balanceCents).toBe(0);
      expect(res.body.priceCents).toBe(price);
      expect(res.body.shortfallCents).toBe(price);

      // Lesson status still no_show.
      const lessonAfter = await adminDb()
        .select({ status: lessons.status })
        .from(lessons)
        .where(eq(lessons.id, lessonId))
        .limit(1);
      expect(lessonAfter[0]?.status).toBe("no_show");

      // No second lesson_charge was written — just the original.
      const charges = await adminDb()
        .select({ id: householdBalanceLedger.id })
        .from(householdBalanceLedger)
        .where(
          and(
            eq(householdBalanceLedger.lessonId, lessonId),
            eq(householdBalanceLedger.entryType, "lesson_charge"),
          ),
        );
      expect(charges).toHaveLength(1);
    });
  });

  it("chargeType='free' on undo lands the status change with no re-charge, even when balance is low", async () => {
    await wipeArtifacts();
    await withAllDaysEnabled(async () => {
      const { lessonId, price } = await bookAndNoShow();
      await adminDb().insert(householdBalanceLedger).values({
        householdId: owner.householdId,
        actorId: coach.userId,
        entryType: "coach_adjustment",
        amountCents: -price,
        reason: "test: drain balance before free undo",
      });
      expect(await getHouseholdBalance(owner.householdId)).toBe(0);

      const res = await request(app)
        .patch(`/coach/lessons/${lessonId}/no-show/undo`)
        .set("Authorization", `Bearer ${coach.accessToken}`)
        .send({ chargeType: "free" });
      expect(res.status).toBe(200);

      // Status moved off no_show (completed or approved).
      const lessonAfter = await adminDb()
        .select({ status: lessons.status })
        .from(lessons)
        .where(eq(lessons.id, lessonId))
        .limit(1);
      expect(["completed", "approved"]).toContain(lessonAfter[0]?.status);

      // Only one lesson_charge (the original); balance unchanged.
      const charges = await adminDb()
        .select({ id: householdBalanceLedger.id })
        .from(householdBalanceLedger)
        .where(
          and(
            eq(householdBalanceLedger.lessonId, lessonId),
            eq(householdBalanceLedger.entryType, "lesson_charge"),
          ),
        );
      expect(charges).toHaveLength(1);
      expect(await getHouseholdBalance(owner.householdId)).toBe(0);
    });
  });

  it("undoing a no-show on an originally-free lesson writes no new ledger rows regardless of chargeType", async () => {
    await wipeArtifacts();
    await withAllDaysEnabled(async () => {
      // Coach books a free lesson, then marks it no-show, then undoes.
      const slot = await findFirstAvailableSlot(30);
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

      // Flip approved + past, then no-show.
      await adminDb()
        .update(lessons)
        .set({
          status: "approved",
          startsAt: new Date(Date.now() - 60 * 60 * 1000),
        })
        .where(eq(lessons.id, lessonId));
      const noShowRes = await request(app)
        .patch(`/coach/lessons/${lessonId}/no-show`)
        .set("Authorization", `Bearer ${coach.accessToken}`)
        .send({});
      expect(noShowRes.status).toBe(200);

      // Only the free_lesson marker; no refund_to_balance.
      const beforeUndo = await adminDb()
        .select({ entryType: householdBalanceLedger.entryType })
        .from(householdBalanceLedger)
        .where(eq(householdBalanceLedger.lessonId, lessonId));
      expect(beforeUndo).toHaveLength(1);
      expect(beforeUndo[0]?.entryType).toBe("free_lesson");

      const undoRes = await request(app)
        .patch(`/coach/lessons/${lessonId}/no-show/undo`)
        .set("Authorization", `Bearer ${coach.accessToken}`)
        .send({});
      expect(undoRes.status).toBe(200);

      const afterUndo = await adminDb()
        .select({ entryType: householdBalanceLedger.entryType })
        .from(householdBalanceLedger)
        .where(eq(householdBalanceLedger.lessonId, lessonId));
      expect(afterUndo).toHaveLength(1);
      expect(afterUndo[0]?.entryType).toBe("free_lesson");
    });
  });

  it("undoing twice can't double-charge: the second call returns 422 lesson_not_no_show and no second re-charge is written", async () => {
    await wipeArtifacts();
    await withAllDaysEnabled(async () => {
      const { lessonId, price } = await bookAndNoShow();

      const first = await request(app)
        .patch(`/coach/lessons/${lessonId}/no-show/undo`)
        .set("Authorization", `Bearer ${coach.accessToken}`)
        .send({});
      expect(first.status).toBe(200);

      const second = await request(app)
        .patch(`/coach/lessons/${lessonId}/no-show/undo`)
        .set("Authorization", `Bearer ${coach.accessToken}`)
        .send({});
      expect(second.status).toBe(422);
      expect(second.body.error).toBe("lesson_not_no_show");

      // Exactly 2 lesson_charge rows total — the original + the re-charge
      // from the first undo. The second undo must NOT have written a third.
      const charges = await adminDb()
        .select({ id: householdBalanceLedger.id })
        .from(householdBalanceLedger)
        .where(
          and(
            eq(householdBalanceLedger.lessonId, lessonId),
            eq(householdBalanceLedger.entryType, "lesson_charge"),
          ),
        );
      expect(charges).toHaveLength(2);
      // Balance = 0 (original -price, refund +price, re-charge -price,
      // seed +price). No double-charge symptom.
      expect(await getHouseholdBalance(owner.householdId)).toBe(0);
      // Silence unused-var lint on `price`.
      void price;
    });
  });
});
