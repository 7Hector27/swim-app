// Batch-booking balance behavior (ADR 036 Phase 4).
//
// POST /lessons/batch is all-or-nothing on the household balance: the server
// sums the per-lesson prices under the balance lock, rejects the whole batch
// with 422 insufficient_balance when the balance is short, and on success
// writes one lesson_charge ledger row per lesson (never a single row for
// the batch total). A cancel on one lesson in the batch therefore refunds
// exactly that lesson's amount, leaving the other charges untouched —
// verified in refund tests downstream.

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
  availabilityConfig,
  availabilitySeasons,
  bookingBatches,
  coachNotifications,
  householdBalanceLedger,
  lessonEmailOutbox,
  lessonLocations,
  lessonSwimmers,
  lessons,
  swimmers,
} from "../../db/schema";
import { inArray } from "drizzle-orm";
import { getHouseholdBalance } from "../../services/balance";
import { priceForLesson } from "@swim-app/shared";

const app = createApp(pino({ level: "silent" }));

let owner: TestUser;
let swimmerId: string;
let locationId: string;

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

// Returns `howMany` slots, one per distinct week, so the picks can never
// trip a same-day travel-buffer or daily-cap check across each other —
// the batch is only testing balance behavior, not slot classification.
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
    // Take the first available slot in this week only, then move on to
    // the next week. Guarantees inter-week separation so batch picks
    // never trip each other's day-level checks.
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
  // Grab batch ids before deleting them so we can clear any
  // batch-scoped outbox rows first (FK is ON DELETE RESTRICT).
  const batchRows = await adminDb()
    .select({ id: bookingBatches.id })
    .from(bookingBatches)
    .where(eq(bookingBatches.householdId, owner.householdId));
  const batchIds = batchRows.map((row) => row.id);
  if (batchIds.length > 0) {
    await adminDb()
      .delete(coachNotifications)
      .where(inArray(coachNotifications.batchId, batchIds));
    for (const bid of batchIds) {
      await adminDb().delete(lessonEmailOutbox).where(eq(lessonEmailOutbox.batchId, bid));
    }
  }
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
  await adminDb().delete(bookingBatches).where(eq(bookingBatches.householdId, owner.householdId));
  await adminDb().transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL session_replication_role = replica`);
    await tx.execute(
      sql`DELETE FROM household_balance_ledger WHERE household_id = ${owner.householdId}::uuid`,
    );
  });
}

let originalBookingMaxAdvanceWeeks: number | null = null;

beforeAll(async () => {
  // Batch tests book far in the future; widen the window to 52 weeks as the
  // existing parentBatchBooking suite does.
  const configRows = await adminDb().select().from(availabilityConfig).limit(1);
  const config = configRows[0];
  if (config) {
    originalBookingMaxAdvanceWeeks = config.bookingMaxAdvanceWeeks;
    await adminDb()
      .update(availabilityConfig)
      .set({ bookingMaxAdvanceWeeks: 52 })
      .where(eq(availabilityConfig.id, config.id));
  }

  owner = await createTestUser("batch-charge-owner");

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
      firstName: "BatchCharge",
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
  if (originalBookingMaxAdvanceWeeks !== null) {
    await adminDb()
      .update(availabilityConfig)
      .set({ bookingMaxAdvanceWeeks: originalBookingMaxAdvanceWeeks });
  }
  await owner.cleanup();
  await closeAdminDb();
});

describe("POST /lessons/batch — balance (ADR 036 Phase 4)", () => {
  // Each test starts and ends by wiping the household's lessons + ledger
  // so balance and ledger-count assertions aren't polluted by prior tests
  // in this file.
  async function freshStart(): Promise<void> {
    await wipeArtifacts();
  }

  it("writes one lesson_charge ledger row per lesson (never a single row for the batch total); each row's amount equals that lesson's own priceForLesson", async () => {
    await freshStart();
    await withAllDaysEnabled(async () => {
      const slots = await findAvailableSlots(30, 3);
      const perLessonPrice = priceForLesson(30, 1);
      await seedHouseholdBalanceForTest({
        householdId: owner.householdId,
        actorId: owner.userId,
        amountCents: perLessonPrice * 3,
      });

      const res = await request(app)
        .post("/lessons/batch")
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({
          mode: "manual",
          householdId: owner.householdId,
          locationId,
          picks: slots.map((startsAt) => ({
            startsAt,
            durationMinutes: 30,
            swimmerIds: [swimmerId],
          })),
        });
      expect(res.status).toBe(201);
      const lessonIds = res.body.lessonIds as string[];
      expect(lessonIds).toHaveLength(3);

      const chargeRows = await adminDb()
        .select({
          lessonId: householdBalanceLedger.lessonId,
          amountCents: householdBalanceLedger.amountCents,
          entryType: householdBalanceLedger.entryType,
        })
        .from(householdBalanceLedger)
        .where(
          and(
            eq(householdBalanceLedger.householdId, owner.householdId),
            eq(householdBalanceLedger.entryType, "lesson_charge"),
          ),
        );
      expect(chargeRows).toHaveLength(3);
      // Exactly one charge row per lesson, each at -perLessonPrice.
      const byLesson = new Map(chargeRows.map((row) => [row.lessonId, row.amountCents]));
      for (const id of lessonIds) {
        expect(byLesson.get(id)).toBe(-perLessonPrice);
      }
      // No batch-total shortcut row: the sum across the per-lesson
      // rows equals the total price, but no single row carries it.
      const total = chargeRows.reduce((sum, row) => sum + row.amountCents, 0);
      expect(total).toBe(-perLessonPrice * 3);
      expect(await getHouseholdBalance(owner.householdId)).toBe(0);
      await wipeArtifacts();
    });
  });

  it("refuses the whole batch with 422 insufficient_balance when the total exceeds balance; no lesson or charge row is written (all-or-nothing)", async () => {
    await freshStart();
    await withAllDaysEnabled(async () => {
      const slots = await findAvailableSlots(30, 3);
      const perLessonPrice = priceForLesson(30, 1);
      const totalPrice = perLessonPrice * 3;
      // Seed enough to cover 2 of 3 lessons so the server must reject
      // on the sum, not on the first-lesson-individually logic.
      await seedHouseholdBalanceForTest({
        householdId: owner.householdId,
        actorId: owner.userId,
        amountCents: perLessonPrice * 2,
      });

      const res = await request(app)
        .post("/lessons/batch")
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({
          mode: "manual",
          householdId: owner.householdId,
          locationId,
          picks: slots.map((startsAt) => ({
            startsAt,
            durationMinutes: 30,
            swimmerIds: [swimmerId],
          })),
        });
      expect(res.status).toBe(422);
      expect(res.body.error).toBe("insufficient_balance");
      expect(res.body.balanceCents).toBe(perLessonPrice * 2);
      expect(res.body.priceCents).toBe(totalPrice);
      expect(res.body.shortfallCents).toBe(totalPrice - perLessonPrice * 2);

      // No lesson or charge row survived the all-or-nothing rollback.
      const lessonRows = await adminDb()
        .select({ id: lessons.id })
        .from(lessons)
        .where(eq(lessons.householdId, owner.householdId));
      expect(lessonRows).toHaveLength(0);
      const chargeRows = await adminDb()
        .select({ id: householdBalanceLedger.id })
        .from(householdBalanceLedger)
        .where(
          and(
            eq(householdBalanceLedger.householdId, owner.householdId),
            eq(householdBalanceLedger.entryType, "lesson_charge"),
          ),
        );
      expect(chargeRows).toHaveLength(0);
      // Balance is still the pre-batch seed (coach_adjustment row).
      expect(await getHouseholdBalance(owner.householdId)).toBe(perLessonPrice * 2);
      await wipeArtifacts();
    });
  });
});
