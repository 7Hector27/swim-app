import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import pino from "pino";
import { eq, inArray } from "drizzle-orm";
import { createApp } from "../../app";
import {
  adminDb,
  closeAdminDb,
  createTestUser,
  createTestUserInHousehold,
  seedHouseholdBalanceForTest,
  settleAndCleanupCoachNotificationsForHousehold,
  type TestUser,
} from "./helpers";
import {
  availabilitySeasons,
  lessonEmailOutbox,
  lessonLocations,
  lessonSwimmers,
  lessons,
  swimmers,
} from "../../db/schema";

const logger = pino({ level: "silent" });
const app = createApp(logger);

// ── Shared state ──────────────────────────────────────────────────────────────

let owner: TestUser;
let viewer: TestUser;
let locationId: string;
let swimmerId: string;

// A future Tuesday in school-year. Must be in config.lessonDays.
// Using a date far enough in the future to be within 10 weeks but > 16 h away.
function futureSlot(): string {
  // 4:30 PM (16:30) America/Los_Angeles, 2 days from now.
  // Mirrors laToUtc() in slots.ts so this is correct in both PST and PDT.
  const twoDaysOut = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  const laParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(twoDaysOut);
  const get = (t: string) => Number(laParts.find((p) => p.type === t)?.value ?? 0);
  const [year, month0, day] = [get("year"), get("month") - 1, get("day")];
  // PDT initial approximation (UTC-7); corrected below for PST.
  const approxMs = Date.UTC(year, month0, day, 23, 30); // 16:30 + 7
  const toWallMs = (tz: string) => {
    const pp = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, year: "numeric", month: "numeric", day: "numeric",
      hour: "numeric", minute: "numeric", second: "numeric", hour12: false,
    }).formatToParts(new Date(approxMs));
    const g = (t: string) => Number(pp.find((p) => p.type === t)?.value ?? 0);
    return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"), g("second"));
  };
  const offsetMs = toWallMs("UTC") - toWallMs("America/Los_Angeles");
  return new Date(Date.UTC(year, month0, day, 16, 30) + offsetMs).toISOString();
}

beforeAll(async () => {
  owner = await createTestUser("lessons-owner");
  // ADR 036 Phase 4: parent bookings charge the balance. Seed enough to
  // cover every booking in this file plus headroom; individual tests
  // don't assert on specific balance values.
  await seedHouseholdBalanceForTest({
    householdId: owner.householdId,
    actorId: owner.userId,
    amountCents: 1_000_000,
  });
  viewer = await createTestUserInHousehold("lessons-viewer", owner.householdId, "viewer");

  // Get the first named location.
  const locs = await adminDb()
    .select({ id: lessonLocations.id })
    .from(lessonLocations)
    .where(eq(lessonLocations.isActive, true))
    .limit(1);
  locationId = locs[0]?.id ?? "";

  // Create a swimmer for the owner's household.
  const swimmerRows = await adminDb()
    .insert(swimmers)
    .values({
      firstName: "TestSwimmer",
      lastName: "Integration",
      birthDate: "2015-01-01",
      sex: "female",
      isPublic: false,
      householdId: owner.householdId,
    })
    .returning({ id: swimmers.id });
  swimmerId = swimmerRows[0]?.id ?? "";
});

afterAll(async () => {
  // Clean up lessons + lesson_swimmers (cascade) then swimmers.
  if (swimmerId) {
    // lesson_email_outbox FKs lessons.id with ON DELETE RESTRICT (ADR 028).
    const ownerLessonIds = await adminDb()
      .select({ id: lessons.id })
      .from(lessons)
      .where(eq(lessons.householdId, owner.householdId));
    // coach_notifications.lesson_id is ON DELETE RESTRICT (ADR 031):
    // settle in-flight notify* stubs and purge coach_notifications first.
    await settleAndCleanupCoachNotificationsForHousehold(owner.householdId);
    if (ownerLessonIds.length > 0) {
      await adminDb()
        .delete(lessonEmailOutbox)
        .where(inArray(lessonEmailOutbox.lessonId, ownerLessonIds.map((row) => row.id)));
    }
    await adminDb().delete(lessonSwimmers).where(eq(lessonSwimmers.swimmerId, swimmerId));
    await adminDb().delete(lessons).where(eq(lessons.householdId, owner.householdId));
    await adminDb().delete(swimmers).where(eq(swimmers.id, swimmerId));
  }
  if (viewer) await viewer.cleanup();
  if (owner) await owner.cleanup();
  await closeAdminDb();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

// Temporarily opens all seven days on every season so a slot always exists
// regardless of the day the test runs, then restores the original teachesDays
// per-season.
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

// Queries the available-range endpoint week by week until it finds the first
// slot with state "available". Must be called while allDays is enabled.
async function findFirstAvailableSlot(
  token: string,
  locId: string,
  durationMinutes: number,
): Promise<string> {
  for (let weekOffset = 0; weekOffset < 10; weekOffset++) {
    const weekDate = new Date(Date.now() + weekOffset * 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const res = await request(app)
      .get("/lessons/available-range")
      .set("Authorization", `Bearer ${token}`)
      .query({ view: "week", date: weekDate, durationMinutes: String(durationMinutes), locationId: locId });
    if (res.status !== 200) continue;
    const body = res.body as { days: Array<{ slots: Array<{ startsAt: string; state: string }> }> };
    for (const day of body.days) {
      for (const slot of day.slots) {
        if (slot.state === "available") return slot.startsAt;
      }
    }
  }
  throw new Error("No available slot found within 10 weeks — check lessonDays / teaching-window config");
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /lessons (integration)", () => {
  it("viewer calling POST /lessons → 403", async () => {
    const res = await request(app)
      .post("/lessons")
      .set("Authorization", `Bearer ${viewer.accessToken}`)
      .send({
        startsAt: futureSlot(),
        durationMinutes: 30,
        locationId,
        swimmerIds: [swimmerId],
      });

    expect(res.status).toBe(403);
  });

  it("concurrent booking: exactly one succeeds, the other gets 422 slot_unavailable", async () => {
    if (!locationId || !swimmerId) {
      console.warn("Skipping concurrent test: no location or swimmer available");
      return;
    }

    await withAllDaysEnabled(async () => {
      // First, create a second test user so we have two separate households
      // trying to book the same slot simultaneously.
      const owner2 = await createTestUser("lessons-concurrent");
      await seedHouseholdBalanceForTest({
        householdId: owner2.householdId,
        actorId: owner2.userId,
        amountCents: 1_000_000,
      });
      const swimmerRows2 = await adminDb()
        .insert(swimmers)
        .values({
          firstName: "TestSwimmer2",
          lastName: "Concurrent",
          birthDate: "2015-01-01",
          sex: "male",
          isPublic: false,
          householdId: owner2.householdId,
        })
        .returning({ id: swimmers.id });
      const swimmerId2 = swimmerRows2[0]?.id ?? "";

      try {
        const slot = await findFirstAvailableSlot(owner.accessToken, locationId, 30);

        const [res1, res2] = await Promise.all([
          request(app)
            .post("/lessons")
            .set("Authorization", `Bearer ${owner.accessToken}`)
            .send({ startsAt: slot, durationMinutes: 30, locationId, swimmerIds: [swimmerId] }),
          request(app)
            .post("/lessons")
            .set("Authorization", `Bearer ${owner2.accessToken}`)
            .send({ startsAt: slot, durationMinutes: 30, locationId, swimmerIds: [swimmerId2] }),
        ]);

        const statuses = [res1.status, res2.status].sort();
        const failBody = res1.status === 422 ? res1.body : res2.body;
        expect(
          statuses,
          `expected [201,422] for slot ${slot} — res1 ${res1.status}: ${JSON.stringify(res1.body)}, res2 ${res2.status}: ${JSON.stringify(res2.body)}`,
        ).toEqual([201, 422]);

        expect(failBody.error).toBe("slot_unavailable");

        // Clean up lessons created in this test — settle notify* stubs and
        // purge coach_notifications first (ADR 031 FK is ON DELETE RESTRICT),
        // then outbox rows (ADR 028 same reason).
        await settleAndCleanupCoachNotificationsForHousehold(owner2.householdId);
        await settleAndCleanupCoachNotificationsForHousehold(owner.householdId);
        const concLessonIds = await adminDb()
          .select({ id: lessons.id })
          .from(lessons)
          .where(inArray(lessons.householdId, [owner2.householdId, owner.householdId]));
        if (concLessonIds.length > 0) {
          await adminDb()
            .delete(lessonEmailOutbox)
            .where(inArray(lessonEmailOutbox.lessonId, concLessonIds.map((row) => row.id)));
        }
        await adminDb().delete(lessons).where(eq(lessons.householdId, owner2.householdId));
        await adminDb().delete(lessons).where(eq(lessons.householdId, owner.householdId));
        await adminDb().delete(swimmers).where(eq(swimmers.id, swimmerId2));
      } finally {
        await owner2.cleanup();
      }
    });
  });
});
