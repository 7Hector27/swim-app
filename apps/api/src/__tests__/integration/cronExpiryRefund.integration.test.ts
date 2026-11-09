// Expired-pending refund (ADR 036 §4, cron path).
//
// POST /internal/cron/tick's expired-pending pass refunds each expired
// lesson's charge inside the same transaction as the status change. The
// per-household balance lock is acquired in a stable order (sorted by
// household id) so the cron never deadlocks against a concurrent human
// writer. Because the audit log's actor_id is NOT NULL, the cron uses
// the lesson's original requestedBy as the actor on the refund audit.

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
  householdAuditLog,
  householdBalanceLedger,
  lessonEmailOutbox,
  lessonLocations,
  lessonSwimmers,
  lessons,
  swimmers,
} from "../../db/schema";
import { getHouseholdBalance } from "../../services/balance";
import { priceForLesson } from "@swim-app/shared";

const CRON_SECRET =
  process.env["CRON_SECRET"] ?? "test-cron-secret-aaaaaaaaaaaaaaaaaa";

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
  owner = await createTestUser("cron-expiry-owner");

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
      firstName: "CronExpiry",
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
  await closeAdminDb();
});

describe("POST /internal/cron/tick — expired-pending refund (ADR 036 §4)", () => {
  it("refunds the lesson_charge of each expired-pending lesson in the same tx as the status change; audit uses the original requestedBy as actor", async () => {
    await wipeArtifacts();
    await withAllDaysEnabled(async () => {
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
      expect(bookRes.status).toBe(201);
      const lessonId = bookRes.body.id as string;

      // Force the lesson into pending-but-past-its-expiry.
      await adminDb()
        .update(lessons)
        .set({
          status: "pending",
          expiresAt: new Date(Date.now() - 60 * 60 * 1000), // 1h ago
        })
        .where(eq(lessons.id, lessonId));

      const balanceBeforeCron = await getHouseholdBalance(owner.householdId);

      const cronRes = await request(app)
        .post("/internal/cron/tick")
        .set("cron-secret", CRON_SECRET);
      expect(cronRes.status).toBe(200);
      expect(cronRes.body.expired).toBe(1);

      // Lesson flipped to expired.
      const lessonAfter = (
        await adminDb()
          .select({ status: lessons.status })
          .from(lessons)
          .where(eq(lessons.id, lessonId))
          .limit(1)
      )[0];
      expect(lessonAfter?.status).toBe("expired");

      // Ledger carries a refund_to_balance of the original charge amount.
      const refundRows = await adminDb()
        .select({
          amountCents: householdBalanceLedger.amountCents,
          actorId: householdBalanceLedger.actorId,
        })
        .from(householdBalanceLedger)
        .where(
          and(
            eq(householdBalanceLedger.lessonId, lessonId),
            eq(householdBalanceLedger.entryType, "refund_to_balance"),
          ),
        );
      expect(refundRows).toHaveLength(1);
      expect(refundRows[0]?.amountCents).toBe(price);
      // Cron uses the lesson's requestedBy (the parent who booked) as the
      // actor so the audit log's NOT NULL actor_id has a meaningful name.
      expect(refundRows[0]?.actorId).toBe(owner.userId);

      // Balance climbed by the refund amount.
      expect(await getHouseholdBalance(owner.householdId)).toBe(
        balanceBeforeCron + price,
      );

      // Matching audit row.
      const auditRows = await adminDb()
        .select({
          action: householdAuditLog.action,
          actorId: householdAuditLog.actorId,
        })
        .from(householdAuditLog)
        .where(
          and(
            eq(householdAuditLog.householdId, owner.householdId),
            eq(householdAuditLog.action, "balance_lesson_refunded"),
          ),
        );
      expect(auditRows.length).toBeGreaterThanOrEqual(1);
      expect(auditRows[auditRows.length - 1]?.actorId).toBe(owner.userId);
    });
  });
});
