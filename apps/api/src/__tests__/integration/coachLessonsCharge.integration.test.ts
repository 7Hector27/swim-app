// Coach-booking balance behavior (ADR 036 Phase 4).
//
// POST /coach/lessons now carries a `chargeType: 'balance' | 'free'`
// discriminator. `balance` charges the household's balance at the current
// pricing module rate and refuses with 422 insufficient_balance when the
// balance can't cover it. `free` writes a `free_lesson` ledger marker
// (amount 0) and never moves the balance. Both paths write the usual
// lesson + audit + outbox rows in one transaction.

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
  await adminDb()
    .update(profiles)
    .set({ role: "coach" })
    .where(eq(profiles.id, userId));
}

async function withAllDaysEnabled<T>(fn: () => Promise<T>): Promise<T> {
  const seasons = await adminDb().select().from(availabilitySeasons);
  const originals = seasons.map((season) => ({
    id: season.id,
    teachesDays: season.teachesDays,
  }));
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

async function wipeHouseholdArtifacts(householdId: string): Promise<void> {
  await settleAndCleanupCoachNotificationsForHousehold(householdId);
  const householdLessons = await adminDb()
    .select({ id: lessons.id })
    .from(lessons)
    .where(eq(lessons.householdId, householdId));
  const ids = householdLessons.map((row) => row.id);
  if (ids.length > 0) {
    for (const id of ids) {
      await adminDb().delete(lessonEmailOutbox).where(eq(lessonEmailOutbox.lessonId, id));
      await adminDb().delete(lessonSwimmers).where(eq(lessonSwimmers.lessonId, id));
    }
    await adminDb().delete(lessons).where(eq(lessons.householdId, householdId));
  }
  await adminDb().transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL session_replication_role = replica`);
    await tx.execute(
      sql`DELETE FROM household_balance_ledger WHERE household_id = ${householdId}::uuid`,
    );
  });
}

beforeAll(async () => {
  coach = await createTestUser("coach-charge-coach");
  await makeCoach(coach.userId);
  owner = await createTestUser("coach-charge-owner");

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
      firstName: "CoachCharge",
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
  await wipeHouseholdArtifacts(owner.householdId);
  await owner.cleanup();
  await coach.cleanup();
  await closeAdminDb();
});

describe("POST /coach/lessons — chargeType (ADR 036 Phase 4)", () => {
  it("chargeType='balance' writes a lesson_charge of -priceForLesson and drops the balance by that amount", async () => {
    await withAllDaysEnabled(async () => {
      const price = priceForLesson(30, 1);
      await seedHouseholdBalanceForTest({
        householdId: owner.householdId,
        actorId: owner.userId,
        amountCents: price,
      });
      expect(await getHouseholdBalance(owner.householdId)).toBe(price);

      const slot = await findFirstAvailableSlot(30);
      const res = await request(app)
        .post("/coach/lessons")
        .set("Authorization", `Bearer ${coach.accessToken}`)
        .send({
          householdId: owner.householdId,
          swimmerIds: [swimmerId],
          locationId,
          startsAt: slot,
          durationMinutes: 30,
          chargeType: "balance",
        });
      expect(res.status).toBe(201);
      const lessonId = res.body.id as string;

      const chargeRows = await adminDb()
        .select({
          entryType: householdBalanceLedger.entryType,
          amountCents: householdBalanceLedger.amountCents,
          actorId: householdBalanceLedger.actorId,
        })
        .from(householdBalanceLedger)
        .where(
          and(
            eq(householdBalanceLedger.lessonId, lessonId),
            eq(householdBalanceLedger.entryType, "lesson_charge"),
          ),
        );
      expect(chargeRows).toHaveLength(1);
      expect(chargeRows[0]?.amountCents).toBe(-price);
      expect(chargeRows[0]?.actorId).toBe(coach.userId);

      expect(await getHouseholdBalance(owner.householdId)).toBe(0);
      await wipeHouseholdArtifacts(owner.householdId);
    });
  });

  it("chargeType='balance' refuses with 422 insufficient_balance when the household's balance can't cover the price", async () => {
    await withAllDaysEnabled(async () => {
      const price = priceForLesson(30, 1);
      expect(await getHouseholdBalance(owner.householdId)).toBe(0);

      const slot = await findFirstAvailableSlot(30);
      const res = await request(app)
        .post("/coach/lessons")
        .set("Authorization", `Bearer ${coach.accessToken}`)
        .send({
          householdId: owner.householdId,
          swimmerIds: [swimmerId],
          locationId,
          startsAt: slot,
          durationMinutes: 30,
          chargeType: "balance",
        });
      expect(res.status).toBe(422);
      expect(res.body.error).toBe("insufficient_balance");
      expect(res.body.balanceCents).toBe(0);
      expect(res.body.priceCents).toBe(price);
      expect(res.body.shortfallCents).toBe(price);

      const lessonRows = await adminDb()
        .select({ id: lessons.id })
        .from(lessons)
        .where(eq(lessons.householdId, owner.householdId));
      expect(lessonRows).toHaveLength(0);
      expect(await getHouseholdBalance(owner.householdId)).toBe(0);
    });
  });

  it("chargeType='free' writes a free_lesson marker (amount 0) and does NOT move the balance", async () => {
    await withAllDaysEnabled(async () => {
      expect(await getHouseholdBalance(owner.householdId)).toBe(0);

      const slot = await findFirstAvailableSlot(30);
      const res = await request(app)
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
      expect(res.status).toBe(201);
      const lessonId = res.body.id as string;

      const markerRows = await adminDb()
        .select({
          entryType: householdBalanceLedger.entryType,
          amountCents: householdBalanceLedger.amountCents,
        })
        .from(householdBalanceLedger)
        .where(eq(householdBalanceLedger.lessonId, lessonId));
      expect(markerRows).toHaveLength(1);
      expect(markerRows[0]?.entryType).toBe("free_lesson");
      expect(markerRows[0]?.amountCents).toBe(0);

      expect(await getHouseholdBalance(owner.householdId)).toBe(0);
      await wipeHouseholdArtifacts(owner.householdId);
    });
  });

  it("chargeType defaults to 'balance' when the field is omitted (coach can't accidentally give a free lesson)", async () => {
    await withAllDaysEnabled(async () => {
      const price = priceForLesson(30, 1);
      await seedHouseholdBalanceForTest({
        householdId: owner.householdId,
        actorId: owner.userId,
        amountCents: price,
      });

      const slot = await findFirstAvailableSlot(30);
      const res = await request(app)
        .post("/coach/lessons")
        .set("Authorization", `Bearer ${coach.accessToken}`)
        .send({
          householdId: owner.householdId,
          swimmerIds: [swimmerId],
          locationId,
          startsAt: slot,
          durationMinutes: 30,
          // chargeType omitted
        });
      expect(res.status).toBe(201);
      const lessonId = res.body.id as string;

      const markerRows = await adminDb()
        .select({ entryType: householdBalanceLedger.entryType })
        .from(householdBalanceLedger)
        .where(eq(householdBalanceLedger.lessonId, lessonId));
      expect(markerRows).toHaveLength(1);
      expect(markerRows[0]?.entryType).toBe("lesson_charge");
      await wipeHouseholdArtifacts(owner.householdId);
    });
  });
});
