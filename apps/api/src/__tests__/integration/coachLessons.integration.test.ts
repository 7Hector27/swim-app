import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import pino from "pino";
import { and, eq, inArray } from "drizzle-orm";
import { createApp } from "../../app";
import {
  adminDb,
  closeAdminDb,
  createTestUser,
  createTestUserInHousehold,
  settleAndCleanupCoachNotificationsForHousehold,
  type TestUser,
} from "./helpers";
import {
  accountDeletionJobs,
  availabilityConfig,
  availabilitySeasons,
  lessonEmailOutbox,
  lessonLocations,
  lessonSwimmers,
  lessons,
  profiles,
  swimmers,
} from "../../db/schema";
import { getDateInLA } from "../../lib/slots";

const logger = pino({ level: "silent" });
const app = createApp(logger);

let owner: TestUser;
let coach: TestUser;
let locationId: string;
let swimmerId: string;

async function makeCoach(userId: string): Promise<void> {
  await adminDb()
    .update(profiles)
    .set({ role: "coach" })
    .where(eq(profiles.id, userId));
}

// Temporarily opens all seven days on every season so a slot exists
// regardless of the day the test runs.
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

// Walks available-range week by week until it finds the first slot with state "available".
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
  throw new Error("No available slot found within 10 weeks");
}

beforeAll(async () => {
  owner = await createTestUser("coach-lessons-int-owner");
  coach = await createTestUser("coach-lessons-int-coach");
  await makeCoach(coach.userId);

  const locs = await adminDb()
    .select({ id: lessonLocations.id })
    .from(lessonLocations)
    .where(eq(lessonLocations.isActive, true))
    .limit(1);
  locationId = locs[0]?.id ?? "";

  const swimmerRows = await adminDb()
    .insert(swimmers)
    .values({
      firstName: "CoachInt",
      lastName: "Swimmer",
      birthDate: "2015-01-01",
      sex: "female",
      isPublic: false,
      householdId: owner.householdId,
    })
    .returning({ id: swimmers.id });
  swimmerId = swimmerRows[0]?.id ?? "";
});

afterAll(async () => {
  if (swimmerId) {
    // Outbox rows reference lessons with ON DELETE RESTRICT (ADR 028).
    // coach_notifications also references lessons with ON DELETE RESTRICT
    // (ADR 031) — settle and purge first.
    await settleAndCleanupCoachNotificationsForHousehold(owner.householdId);
    const ownerLessonIds = await adminDb()
      .select({ id: lessons.id })
      .from(lessons)
      .where(eq(lessons.householdId, owner.householdId));
    if (ownerLessonIds.length > 0) {
      await adminDb()
        .delete(lessonEmailOutbox)
        .where(inArray(lessonEmailOutbox.lessonId, ownerLessonIds.map((row) => row.id)));
    }
    await adminDb().delete(lessonSwimmers).where(eq(lessonSwimmers.swimmerId, swimmerId));
    await adminDb().delete(lessons).where(eq(lessons.householdId, owner.householdId));
    await adminDb().delete(swimmers).where(eq(swimmers.id, swimmerId));
  }
  if (coach) await coach.cleanup();
  if (owner) await owner.cleanup();
  await closeAdminDb();
});

describe("PATCH /lessons/:id coach reschedule (integration)", () => {
  it("double-booking: coach moving a lesson to an occupied slot returns 422 slot_unavailable", async () => {
    await withAllDaysEnabled(async () => {
      const slot1 = await findFirstAvailableSlot(owner.accessToken, locationId, 30);
      const resA = await request(app)
        .post("/lessons")
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({ locationId, startsAt: slot1, durationMinutes: 30, swimmerIds: [swimmerId] });
      expect(resA.status).toBe(201);
      const lessonAId = resA.body.id as string;

      // Find the next available slot — slot1 is now occupied, so this will be a different time.
      const slot2 = await findFirstAvailableSlot(owner.accessToken, locationId, 30);
      const resB = await request(app)
        .post("/lessons")
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({ locationId, startsAt: slot2, durationMinutes: 30, swimmerIds: [swimmerId] });
      expect(resB.status).toBe(201);
      const lessonBId = resB.body.id as string;

      // Coach tries to move lesson B to slot1 (already taken by lesson A).
      const res = await request(app)
        .patch(`/lessons/${lessonBId}`)
        .set("Authorization", `Bearer ${coach.accessToken}`)
        .send({ startsAt: slot1 });

      expect(res.status).toBe(422);
      expect(res.body.error).toBe("slot_unavailable");

      // Cleanup — settle notify* stubs and purge coach_notifications
      // first (ON DELETE RESTRICT, ADR 031), then outbox rows (ADR 028).
      await settleAndCleanupCoachNotificationsForHousehold(owner.householdId);
      await adminDb()
        .delete(lessonEmailOutbox)
        .where(inArray(lessonEmailOutbox.lessonId, [lessonAId, lessonBId]));
      await adminDb()
        .delete(lessonSwimmers)
        .where(inArray(lessonSwimmers.lessonId, [lessonAId, lessonBId]));
      await adminDb()
        .delete(lessons)
        .where(inArray(lessons.id, [lessonAId, lessonBId]));
    });
  });

  it("daily cap: coach moving a lesson to a full day returns 422 slot_unavailable", async () => {
    await withAllDaysEnabled(async () => {
      const configRows = await adminDb()
        .select({ maxDailyLessonMinutes: availabilityConfig.maxDailyLessonMinutes })
        .from(availabilityConfig)
        .limit(1);
      const maxDailyMinutes = configRows[0]?.maxDailyLessonMinutes ?? 240;

      // Find slot X on day D. We'll fill day D to capacity using direct DB inserts.
      const slotX = await findFirstAvailableSlot(owner.accessToken, locationId, 30);
      const dayD = getDateInLA(new Date(slotX));

      // Insert enough fake lessons on day D (at consecutive 30-min slots starting at slotX)
      // so their total equals maxDailyMinutes. These count toward the daily cap check.
      const numFake = Math.floor(maxDailyMinutes / 30);
      const fakeLessonIds: string[] = [];
      for (let index = 0; index < numFake; index++) {
        const fakeStartsAt = new Date(new Date(slotX).getTime() + index * 30 * 60 * 1000);
        const [inserted] = await adminDb()
          .insert(lessons)
          .values({
            householdId: owner.householdId,
            locationId,
            startsAt: fakeStartsAt,
            durationMinutes: 30,
            type: "private",
            status: "pending",
            requestedBy: owner.userId,
            expiresAt: new Date(fakeStartsAt.getTime() - 16 * 60 * 60 * 1000),
          })
          .returning({ id: lessons.id });
        fakeLessonIds.push(inserted!.id);
      }

      // Day D is now at the daily cap — findFirstAvailableSlot returns a slot on a later day.
      const slotY = await findFirstAvailableSlot(owner.accessToken, locationId, 30);
      expect(getDateInLA(new Date(slotY))).not.toBe(dayD);

      // Book lesson Y on day Y via the API.
      const resY = await request(app)
        .post("/lessons")
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({ locationId, startsAt: slotY, durationMinutes: 30, swimmerIds: [swimmerId] });
      expect(resY.status).toBe(201);
      const lessonYId = resY.body.id as string;

      // Coach tries to move lesson Y to slotX (day D is at the daily cap).
      const res = await request(app)
        .patch(`/lessons/${lessonYId}`)
        .set("Authorization", `Bearer ${coach.accessToken}`)
        .send({ startsAt: slotX });

      expect(res.status).toBe(422);
      expect(res.body.error).toBe("slot_unavailable");

      // Cleanup fake lessons, then lesson Y. Settle + purge coach_notifications
      // first (ADR 031), then outbox rows (ADR 028).
      await settleAndCleanupCoachNotificationsForHousehold(owner.householdId);
      const allIds = [...fakeLessonIds, lessonYId];
      await adminDb()
        .delete(lessonEmailOutbox)
        .where(inArray(lessonEmailOutbox.lessonId, allIds));
      await adminDb()
        .delete(lessonSwimmers)
        .where(and(inArray(lessonSwimmers.lessonId, allIds)));
      await adminDb()
        .delete(lessons)
        .where(inArray(lessons.id, allIds));
    });
  });
});

// ── GET /coach/lessons/:id householdName picks a non-scrubbed member ─────────

describe("GET /coach/lessons/:id — householdName after a leave-deletion", () => {
  it("returns the remaining owner's fullName (never null) when a household member ran leave-deletion and their profile is now scrubbed", async () => {
    // Set up a household with a named owner and a manager who will
    // self-delete. The engine's leave path removes the manager's
    // household_members row AND scrubs their profile (full_name = NULL,
    // disabled_at set), but the household and the owner's membership
    // survive untouched. If the coach lesson detail picker didn't
    // filter on disabled_at, a household where the scrubbed manager
    // happened to sort first would surface null as householdName.
    const owner = await createTestUser("hh-name-leave-owner");
    const manager = await createTestUserInHousehold(
      "hh-name-leave-manager",
      owner.householdId,
      "manager",
    );

    // Give the owner a distinctive fullName so the assertion can key
    // off the real database state rather than a sentinel. The signup
    // trigger leaves fullName null; patch it directly.
    const ownerDisplayName = "Smith Family";
    await adminDb()
      .update(profiles)
      .set({ fullName: ownerDisplayName })
      .where(eq(profiles.id, owner.userId));

    // Seed a lesson for this household that the coach can read.
    const swimmerRows = await adminDb()
      .insert(swimmers)
      .values({
        firstName: "LeaveInt",
        lastName: "Swimmer",
        birthDate: "2015-01-01",
        sex: "female",
        isPublic: false,
        householdId: owner.householdId,
      })
      .returning({ id: swimmers.id });
    const swimmerId = swimmerRows[0]!.id;

    const lessonRows = await adminDb()
      .insert(lessons)
      .values({
        householdId: owner.householdId,
        locationId,
        startsAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        durationMinutes: 30,
        type: "private",
        status: "completed",
        requestedBy: owner.userId,
        approvedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
        approvedBy: owner.userId,
        completedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000 + 30 * 60 * 1000),
      })
      .returning({ id: lessons.id });
    const lessonId = lessonRows[0]!.id;
    await adminDb().insert(lessonSwimmers).values({ lessonId, swimmerId });

    try {
      // Manager runs leave-deletion. Profile gets scrubbed + member row
      // removed; household and owner stay.
      const delRes = await request(app)
        .post("/me/deletion/confirm")
        .set("Authorization", `Bearer ${manager.accessToken}`)
        .send({
          password: "integration-test-password-1",
          confirmationPhrase: "delete",
        });
      expect(delRes.status).toBe(204);

      // Confirm the state the coach picker is about to query: owner
      // profile live with fullName set, manager profile scrubbed.
      const [ownerAfter, managerAfter] = await Promise.all([
        adminDb().select().from(profiles).where(eq(profiles.id, owner.userId)).limit(1),
        adminDb().select().from(profiles).where(eq(profiles.id, manager.userId)).limit(1),
      ]);
      expect(ownerAfter[0]?.disabledAt).toBeNull();
      expect(ownerAfter[0]?.fullName).toBe(ownerDisplayName);
      expect(managerAfter[0]?.disabledAt).not.toBeNull();
      expect(managerAfter[0]?.fullName).toBeNull();

      // Coach fetches the lesson detail. The household-members picker
      // in the route filters on profiles.disabled_at IS NULL, so the
      // scrubbed manager is skipped and the owner's name is returned.
      const detailRes = await request(app)
        .get(`/coach/lessons/${lessonId}`)
        .set("Authorization", `Bearer ${coach.accessToken}`);
      expect(detailRes.status).toBe(200);
      expect(detailRes.body.householdName).toBe(ownerDisplayName);
      expect(detailRes.body.householdName).not.toBeNull();
    } finally {
      // Teardown. lesson_swimmers → lesson first (both FK to the
      // lesson), then the swimmer, then account_deletion_jobs for the
      // manager, then the test users (owner cleanup removes the
      // household and audit log).
      await adminDb().delete(lessonSwimmers).where(eq(lessonSwimmers.lessonId, lessonId));
      await adminDb().delete(lessons).where(eq(lessons.id, lessonId));
      await adminDb().delete(swimmers).where(eq(swimmers.id, swimmerId));
      await adminDb()
        .delete(accountDeletionJobs)
        .where(eq(accountDeletionJobs.authUserId, manager.userId));
      await manager.cleanup();
      await owner.cleanup();
    }
  });
});
