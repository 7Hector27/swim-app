// Bulk-cancel refund coverage (ADR 036 Phase 4).
//
// POST /coach/lessons/bulk-cancel refunds every affected lesson's charge
// in the same transaction as the status change, under per-household
// balance locks acquired in sorted order (deterministic — the cron can't
// deadlock against concurrent writers). Covers:
//
// - two different families in the sweep each get their own refund
// - mixed free + charged lessons: the free_lesson marker no-ops, the
//   charged lesson refunds its exact amount
// - a pending lesson in the sweep (decline path) also refunds

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import pino from "pino";
import { and, eq, inArray, sql } from "drizzle-orm";

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
  availabilityOverrides,
  blockedTimes,
  bulkCancellations,
  householdAuditLog,
  householdBalanceLedger,
  lessonEmailOutbox,
  lessonLocations,
  lessonSwimmers,
  lessons,
  profiles,
  swimmers,
} from "../../db/schema";
import { priceForLesson } from "@swim-app/shared";
import { getHouseholdBalance } from "../../services/balance";
import { laToUtc } from "../../lib/slots";
import { applyLedgerEntry, withBalanceLock } from "../../services/balance";

vi.mock("../../services/googleCalendarSync", () => ({
  syncLessonToGoogle: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../services/emails/sender", () => ({
  sendLessonEmailOutboxRow: vi.fn().mockResolvedValue(undefined),
}));

const logger = pino({ level: "silent" });
const app = createApp(logger);

let coach: TestUser;
let familyA: TestUser;
let familyB: TestUser;
let locationId: string;
let swimmerAId: string;
let swimmerBId: string;

async function makeCoach(userId: string): Promise<void> {
  await adminDb().update(profiles).set({ role: "coach" }).where(eq(profiles.id, userId));
}

// Compute a future weekday at a fixed LA wall-clock time. Returns the UTC
// Date; the bulk-cancel route re-derives the LA day for the advisory lock.
function futureLessonUtc(daysOut: number, laTime: string): Date {
  const laDate = new Date(Date.now() + daysOut * 24 * 60 * 60 * 1000);
  const laParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(laDate);
  const get = (t: string) => laParts.find((p) => p.type === t)?.value ?? "";
  const isoDate = `${get("year")}-${get("month")}-${get("day")}`;
  return laToUtc(isoDate, laTime);
}

async function createLessonFor(args: {
  householdId: string;
  ownerUserId: string;
  swimmerId: string;
  startsAt: Date;
  status: "approved" | "pending";
}): Promise<string> {
  const [row] = await adminDb()
    .insert(lessons)
    .values({
      householdId: args.householdId,
      locationId,
      startsAt: args.startsAt,
      durationMinutes: 30,
      type: "private",
      status: args.status,
      requestedBy: args.ownerUserId,
      ...(args.status === "approved" && { approvedAt: new Date(), approvedBy: coach.userId }),
      ...(args.status === "pending" && {
        expiresAt: new Date(args.startsAt.getTime() - 16 * 60 * 60 * 1000),
      }),
    })
    .returning({ id: lessons.id });
  const lessonId = row!.id;
  await adminDb().insert(lessonSwimmers).values({ lessonId, swimmerId: args.swimmerId });
  return lessonId;
}

async function chargeLesson(args: {
  householdId: string;
  actorId: string;
  lessonId: string;
  amountCents: number;
}): Promise<void> {
  await withBalanceLock(args.householdId, async (tx) => {
    await applyLedgerEntry(tx, {
      entryType: "lesson_charge",
      householdId: args.householdId,
      actorId: args.actorId,
      lessonId: args.lessonId,
      amountCents: -args.amountCents,
    });
  });
}

async function markFreeLesson(args: {
  householdId: string;
  actorId: string;
  lessonId: string;
}): Promise<void> {
  await withBalanceLock(args.householdId, async (tx) => {
    await applyLedgerEntry(tx, {
      entryType: "free_lesson",
      householdId: args.householdId,
      actorId: args.actorId,
      lessonId: args.lessonId,
    });
  });
}

async function wipeHouseholdArtifacts(householdId: string): Promise<void> {
  await settleAndCleanupCoachNotificationsForHousehold(householdId);
  const householdLessons = await adminDb()
    .select({ id: lessons.id })
    .from(lessons)
    .where(eq(lessons.householdId, householdId));
  const ids = householdLessons.map((row) => row.id);
  if (ids.length > 0) {
    await adminDb().delete(lessonEmailOutbox).where(inArray(lessonEmailOutbox.lessonId, ids));
    await adminDb().delete(lessonSwimmers).where(inArray(lessonSwimmers.lessonId, ids));
    await adminDb().delete(lessons).where(inArray(lessons.id, ids));
  }
  await adminDb()
    .delete(lessonEmailOutbox)
    .where(
      and(
        eq(lessonEmailOutbox.event, "coach_bulk_cancel"),
        eq(lessonEmailOutbox.householdId, householdId),
      ),
    );
  await adminDb().delete(householdAuditLog).where(eq(householdAuditLog.householdId, householdId));
  await adminDb().transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL session_replication_role = replica`);
    await tx.execute(
      sql`DELETE FROM household_balance_ledger WHERE household_id = ${householdId}::uuid`,
    );
  });
}

beforeAll(async () => {
  coach = await createTestUser("bulk-refund-coach");
  await makeCoach(coach.userId);
  familyA = await createTestUser("bulk-refund-familyA");
  familyB = await createTestUser("bulk-refund-familyB");

  const locs = await adminDb()
    .select({ id: lessonLocations.id })
    .from(lessonLocations)
    .where(and(eq(lessonLocations.isActive, true)))
    .limit(1);
  const found = locs[0]?.id;
  if (!found) throw new Error("no active location");
  locationId = found;

  const swimmerA = await adminDb()
    .insert(swimmers)
    .values({
      firstName: "KidA",
      lastName: "Fam",
      birthDate: "2016-01-01",
      sex: "male",
      isPublic: false,
      householdId: familyA.householdId,
    })
    .returning({ id: swimmers.id });
  const swimmerB = await adminDb()
    .insert(swimmers)
    .values({
      firstName: "KidB",
      lastName: "Fam",
      birthDate: "2016-01-01",
      sex: "female",
      isPublic: false,
      householdId: familyB.householdId,
    })
    .returning({ id: swimmers.id });
  swimmerAId = swimmerA[0]!.id;
  swimmerBId = swimmerB[0]!.id;
});

afterAll(async () => {
  await wipeHouseholdArtifacts(familyA.householdId);
  await wipeHouseholdArtifacts(familyB.householdId);
  await adminDb().delete(bulkCancellations).where(eq(bulkCancellations.coachProfileId, coach.userId));
  await adminDb().delete(blockedTimes);
  await adminDb().delete(availabilityOverrides);
  await familyA.cleanup();
  await familyB.cleanup();
  await coach.cleanup();
  await closeAdminDb();
});

describe("POST /coach/lessons/bulk-cancel — refund (ADR 036 Phase 4)", () => {
  it("refunds every affected lesson's charge across multiple families and mixes free+charged correctly", async () => {
    await wipeHouseholdArtifacts(familyA.householdId);
    await wipeHouseholdArtifacts(familyB.householdId);

    // Seed balances so the charges below would come out of real balance.
    const price = priceForLesson(30, 1);
    await seedHouseholdBalanceForTest({
      householdId: familyA.householdId,
      actorId: familyA.userId,
      amountCents: price * 5,
    });
    await seedHouseholdBalanceForTest({
      householdId: familyB.householdId,
      actorId: familyB.userId,
      amountCents: price * 5,
    });

    // Fixed day + time inside the sweep window.
    const sweepStart = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    const laParts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(sweepStart);
    const get = (t: string) => laParts.find((p) => p.type === t)?.value ?? "";
    const sweepLaDate = `${get("year")}-${get("month")}-${get("day")}`;

    // Family A: one approved charged lesson + one pending charged lesson.
    const lessonA1Approved = await createLessonFor({
      householdId: familyA.householdId,
      ownerUserId: familyA.userId,
      swimmerId: swimmerAId,
      startsAt: futureLessonUtc(10, "10:00"),
      status: "approved",
    });
    await chargeLesson({
      householdId: familyA.householdId,
      actorId: coach.userId,
      lessonId: lessonA1Approved,
      amountCents: price,
    });

    const lessonA2Pending = await createLessonFor({
      householdId: familyA.householdId,
      ownerUserId: familyA.userId,
      swimmerId: swimmerAId,
      startsAt: futureLessonUtc(10, "11:00"),
      status: "pending",
    });
    await chargeLesson({
      householdId: familyA.householdId,
      actorId: coach.userId,
      lessonId: lessonA2Pending,
      amountCents: price,
    });

    // Family B: one approved charged + one free (comp). Free lesson has
    // only a free_lesson marker (amount 0); bulk-cancel's refund should
    // no-op on it.
    const lessonB1Approved = await createLessonFor({
      householdId: familyB.householdId,
      ownerUserId: familyB.userId,
      swimmerId: swimmerBId,
      startsAt: futureLessonUtc(10, "12:00"),
      status: "approved",
    });
    await chargeLesson({
      householdId: familyB.householdId,
      actorId: coach.userId,
      lessonId: lessonB1Approved,
      amountCents: price,
    });

    const lessonB2Free = await createLessonFor({
      householdId: familyB.householdId,
      ownerUserId: familyB.userId,
      swimmerId: swimmerBId,
      startsAt: futureLessonUtc(10, "13:00"),
      status: "approved",
    });
    await markFreeLesson({
      householdId: familyB.householdId,
      actorId: coach.userId,
      lessonId: lessonB2Free,
    });

    const balanceABeforeCancel = await getHouseholdBalance(familyA.householdId);
    const balanceBBeforeCancel = await getHouseholdBalance(familyB.householdId);

    const res = await request(app)
      .post("/coach/lessons/bulk-cancel")
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send({
        startDate: sweepLaDate,
        endDate: sweepLaDate,
        blockRange: false,
      });
    expect(res.status).toBe(200);

    // Family A: both lessons refunded.
    const refundsA = await adminDb()
      .select({
        lessonId: householdBalanceLedger.lessonId,
        amountCents: householdBalanceLedger.amountCents,
      })
      .from(householdBalanceLedger)
      .where(
        and(
          eq(householdBalanceLedger.householdId, familyA.householdId),
          eq(householdBalanceLedger.entryType, "refund_to_balance"),
        ),
      );
    expect(refundsA).toHaveLength(2);
    expect(refundsA.every((row) => row.amountCents === price)).toBe(true);
    const refundLessonIdsA = refundsA.map((row) => row.lessonId).sort();
    expect(refundLessonIdsA).toEqual([lessonA1Approved, lessonA2Pending].sort());
    expect(await getHouseholdBalance(familyA.householdId)).toBe(
      balanceABeforeCancel + 2 * price,
    );

    // Family B: only the charged lesson refunded. The free lesson no-ops.
    const refundsB = await adminDb()
      .select({
        lessonId: householdBalanceLedger.lessonId,
        amountCents: householdBalanceLedger.amountCents,
      })
      .from(householdBalanceLedger)
      .where(
        and(
          eq(householdBalanceLedger.householdId, familyB.householdId),
          eq(householdBalanceLedger.entryType, "refund_to_balance"),
        ),
      );
    expect(refundsB).toHaveLength(1);
    expect(refundsB[0]?.lessonId).toBe(lessonB1Approved);
    expect(refundsB[0]?.amountCents).toBe(price);
    expect(await getHouseholdBalance(familyB.householdId)).toBe(
      balanceBBeforeCancel + price,
    );

    // Free lesson B2 has no refund row.
    const refundB2 = await adminDb()
      .select({ id: householdBalanceLedger.id })
      .from(householdBalanceLedger)
      .where(
        and(
          eq(householdBalanceLedger.lessonId, lessonB2Free),
          eq(householdBalanceLedger.entryType, "refund_to_balance"),
        ),
      );
    expect(refundB2).toHaveLength(0);
  });
});
