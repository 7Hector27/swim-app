// Parent-booking balance charge tests (ADR 036 Phase 4).
//
// POST /lessons now computes price from the shared pricing module, reads
// the household balance under the per-household advisory lock, refuses the
// booking with 422 insufficient_balance if the balance isn't enough, and
// writes a lesson_charge ledger row in the same transaction as the lesson
// insert. This file verifies each of those contracts in a real DB round-trip.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import pino from "pino";
import { and, eq } from "drizzle-orm";

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
  lessons,
  swimmers,
} from "../../db/schema";
import { getHouseholdBalance } from "../../services/balance";
import { priceForLesson } from "@swim-app/shared";

const app = createApp(pino({ level: "silent" }));

let owner: TestUser;
let swimmerId: string;
let locationId: string;

// Open every day on every season so slots exist regardless of weekday
// the test runs on. Restored after fn() returns.
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

beforeAll(async () => {
  owner = await createTestUser("parent-charge-owner");

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
      firstName: "ChargeTest",
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
  await settleAndCleanupCoachNotificationsForHousehold(owner.householdId);
  const householdLessons = await adminDb()
    .select({ id: lessons.id })
    .from(lessons)
    .where(eq(lessons.householdId, owner.householdId));
  const ids = householdLessons.map((row) => row.id);
  if (ids.length > 0) {
    for (const id of ids) {
      await adminDb().delete(lessonEmailOutbox).where(eq(lessonEmailOutbox.lessonId, id));
    }
    await adminDb().delete(lessons).where(eq(lessons.householdId, owner.householdId));
  }
  await owner.cleanup();
  await closeAdminDb();
});

describe("POST /lessons — balance charge (ADR 036 Phase 4)", () => {
  it("refuses the booking with 422 insufficient_balance when the household's balance is below the lesson price; no lesson or ledger row is written", async () => {
    await withAllDaysEnabled(async () => {
      const price = priceForLesson(30, 1);
      const balanceBefore = await getHouseholdBalance(owner.householdId);
      expect(balanceBefore).toBe(0);

      const slot = await findFirstAvailableSlot(30);
      const res = await request(app)
        .post("/lessons")
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({
          startsAt: slot,
          durationMinutes: 30,
          locationId,
          swimmerIds: [swimmerId],
        });

      expect(res.status).toBe(422);
      expect(res.body.error).toBe("insufficient_balance");
      expect(res.body.priceCents).toBe(price);
      expect(res.body.balanceCents).toBe(0);
      expect(res.body.shortfallCents).toBe(price);

      // No lesson row inserted.
      const lessonRows = await adminDb()
        .select({ id: lessons.id })
        .from(lessons)
        .where(eq(lessons.householdId, owner.householdId));
      expect(lessonRows).toHaveLength(0);

      expect(await getHouseholdBalance(owner.householdId)).toBe(0);
    });
  });

  it("writes a lesson_charge row equal to -priceForLesson in the same transaction as the lesson insert; balance drops by exactly that amount", async () => {
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
        .post("/lessons")
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({
          startsAt: slot,
          durationMinutes: 30,
          locationId,
          swimmerIds: [swimmerId],
        });

      expect(res.status).toBe(201);
      const lessonId = res.body.id as string;
      expect(typeof lessonId).toBe("string");

      const chargeRows = await adminDb()
        .select({
          amountCents: householdBalanceLedger.amountCents,
          entryType: householdBalanceLedger.entryType,
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
      expect(chargeRows[0]?.actorId).toBe(owner.userId);

      expect(await getHouseholdBalance(owner.householdId)).toBe(0);
    });
  });

  it("rejects a booking with 422 insufficient_balance when the balance is exactly one cent short of the price", async () => {
    await withAllDaysEnabled(async () => {
      const price = priceForLesson(30, 1);
      await seedHouseholdBalanceForTest({
        householdId: owner.householdId,
        actorId: owner.userId,
        amountCents: price - 1,
      });

      const slot = await findFirstAvailableSlot(30);
      const res = await request(app)
        .post("/lessons")
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({
          startsAt: slot,
          durationMinutes: 30,
          locationId,
          swimmerIds: [swimmerId],
        });
      expect(res.status).toBe(422);
      expect(res.body.error).toBe("insufficient_balance");
      expect(res.body.shortfallCents).toBe(1);
    });
  });
});
