import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import pino from "pino";
import { and, eq, inArray } from "drizzle-orm";
import { createApp } from "../../app";
import {
  adminDb,
  closeAdminDb,
  createTestUser,
  type TestUser,
} from "./helpers";
import {
  availabilitySeasons,
  lessonEmailOutbox,
  lessonLocations,
  lessonSwimmers,
  lessons,
  profiles,
  swimmers,
} from "../../db/schema";

// Regression: back-to-back sibling lessons at the same pool during a
// reschedule. The slot picker (/lessons/available-range with excludeLessonId)
// and the server recheck (PATCH /lessons/:id) must agree that an immediately-
// after slot at the same pool is available — no travel buffer, no daily cap
// double-count, no boundary overlap.

const logger = pino({ level: "silent" });
const app = createApp(logger);

let owner: TestUser;
let coach: TestUser;
let locationId: string;
let siblingAId: string;
let siblingBId: string;

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
      .query({
        view: "week",
        date: weekDate,
        durationMinutes: String(durationMinutes),
        locationId: locId,
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
  throw new Error("No available slot found within 10 weeks");
}

beforeAll(async () => {
  owner = await createTestUser("reschedule-sibling-owner");
  coach = await createTestUser("reschedule-sibling-coach");
  await makeCoach(coach.userId);

  const locs = await adminDb()
    .select({ id: lessonLocations.id })
    .from(lessonLocations)
    .where(eq(lessonLocations.isActive, true))
    .limit(1);
  locationId = locs[0]?.id ?? "";

  const [aRow] = await adminDb()
    .insert(swimmers)
    .values({
      firstName: "SiblingA",
      lastName: "Smith",
      birthDate: "2015-01-01",
      sex: "female",
      isPublic: false,
      householdId: owner.householdId,
    })
    .returning({ id: swimmers.id });
  siblingAId = aRow!.id;

  const [bRow] = await adminDb()
    .insert(swimmers)
    .values({
      firstName: "SiblingB",
      lastName: "Smith",
      birthDate: "2016-01-01",
      sex: "male",
      isPublic: false,
      householdId: owner.householdId,
    })
    .returning({ id: swimmers.id });
  siblingBId = bRow!.id;
});

afterAll(async () => {
  const householdLessonIds = await adminDb()
    .select({ id: lessons.id })
    .from(lessons)
    .where(eq(lessons.householdId, owner.householdId));
  if (householdLessonIds.length > 0) {
    const ids = householdLessonIds.map((row) => row.id);
    await adminDb()
      .delete(lessonEmailOutbox)
      .where(inArray(lessonEmailOutbox.lessonId, ids));
    await adminDb()
      .delete(lessonSwimmers)
      .where(inArray(lessonSwimmers.lessonId, ids));
    await adminDb()
      .delete(lessons)
      .where(inArray(lessons.id, ids));
  }
  for (const id of [siblingAId, siblingBId]) {
    if (id) {
      await adminDb().delete(lessonSwimmers).where(eq(lessonSwimmers.swimmerId, id));
      await adminDb().delete(swimmers).where(eq(swimmers.id, id));
    }
  }
  if (coach) await coach.cleanup();
  if (owner) await owner.cleanup();
  await closeAdminDb();
});

async function cleanupLessons(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await adminDb()
    .delete(lessonEmailOutbox)
    .where(inArray(lessonEmailOutbox.lessonId, ids));
  await adminDb()
    .delete(lessonSwimmers)
    .where(inArray(lessonSwimmers.lessonId, ids));
  await adminDb().delete(lessons).where(inArray(lessons.id, ids));
}

// Books two sibling lessons at the same pool on the same day: Sibling A at
// slotX, Sibling B at slotX + 60min (one 30-min gap between them, so the gap
// at slotX + 30min is available).
async function bookSiblingPair(token: string): Promise<{
  slotX: string;
  slotMiddle: string; // slotX + 30
  slotY: string; // slotX + 60
  lessonAId: string;
  lessonBId: string;
}> {
  const slotX = await findFirstAvailableSlot(token, locationId, 30);
  const slotMiddle = new Date(new Date(slotX).getTime() + 30 * 60 * 1000).toISOString();
  const slotY = new Date(new Date(slotX).getTime() + 60 * 60 * 1000).toISOString();

  const resA = await request(app)
    .post("/lessons")
    .set("Authorization", `Bearer ${token}`)
    .send({
      locationId,
      startsAt: slotX,
      durationMinutes: 30,
      swimmerIds: [siblingAId],
    });
  if (resA.status !== 201) throw new Error(`sibling A booking failed: ${resA.status} ${JSON.stringify(resA.body)}`);

  const resB = await request(app)
    .post("/lessons")
    .set("Authorization", `Bearer ${token}`)
    .send({
      locationId,
      startsAt: slotY,
      durationMinutes: 30,
      swimmerIds: [siblingBId],
    });
  if (resB.status !== 201) throw new Error(`sibling B booking failed: ${resB.status} ${JSON.stringify(resB.body)}`);

  return {
    slotX,
    slotMiddle,
    slotY,
    lessonAId: resA.body.id as string,
    lessonBId: resB.body.id as string,
  };
}

describe("Reschedule to back-to-back with sibling at same pool (integration)", () => {
  it("parent: slot picker shows the back-to-back slot as available, and the server accepts the reschedule", async () => {
    await withAllDaysEnabled(async () => {
      const { slotX, slotMiddle, lessonBId } = await bookSiblingPair(owner.accessToken);

      // 1. Slot picker: available-range with excludeLessonId must mark the
      //    back-to-back slot (slotX + 30) as "available".
      const weekDate = new Date(slotX).toISOString().slice(0, 10);
      const rangeRes = await request(app)
        .get("/lessons/available-range")
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .query({
          view: "week",
          date: weekDate,
          durationMinutes: "30",
          locationId,
          excludeLessonId: lessonBId,
        });
      expect(rangeRes.status).toBe(200);
      const rangeBody = rangeRes.body as {
        days: Array<{ slots: Array<{ startsAt: string; state: string }> }>;
      };
      const middleSlotMs = new Date(slotMiddle).getTime();
      const pickerSlot = rangeBody.days
        .flatMap((day) => day.slots)
        .find((slot) => new Date(slot.startsAt).getTime() === middleSlotMs);
      expect(pickerSlot).toBeDefined();
      expect(pickerSlot!.state).toBe("available");

      // 2. Server recheck: PATCH must accept the same slot.
      const patchRes = await request(app)
        .patch(`/lessons/${lessonBId}`)
        .set("Authorization", `Bearer ${owner.accessToken}`)
        .send({ startsAt: slotMiddle });
      expect(patchRes.status).toBe(200);
      expect(patchRes.body.startsAt).toBe(slotMiddle);

      // Cleanup — grab both lesson ids now (lessonAId from closure).
      const lessonIdsToClean = await adminDb()
        .select({ id: lessons.id })
        .from(lessons)
        .where(eq(lessons.householdId, owner.householdId));
      await cleanupLessons(lessonIdsToClean.map((row) => row.id));
    });
  });

  it("coach: slot picker shows the back-to-back slot as available, and the server accepts the reschedule", async () => {
    await withAllDaysEnabled(async () => {
      const { slotX, slotMiddle, lessonBId } = await bookSiblingPair(owner.accessToken);

      const weekDate = new Date(slotX).toISOString().slice(0, 10);
      const rangeRes = await request(app)
        .get("/lessons/available-range")
        .set("Authorization", `Bearer ${coach.accessToken}`)
        .query({
          view: "week",
          date: weekDate,
          durationMinutes: "30",
          locationId,
          excludeLessonId: lessonBId,
        });
      expect(rangeRes.status).toBe(200);
      const rangeBody = rangeRes.body as {
        days: Array<{ slots: Array<{ startsAt: string; state: string }> }>;
      };
      const middleSlotMs = new Date(slotMiddle).getTime();
      const pickerSlot = rangeBody.days
        .flatMap((day) => day.slots)
        .find((slot) => new Date(slot.startsAt).getTime() === middleSlotMs);
      expect(pickerSlot).toBeDefined();
      expect(pickerSlot!.state).toBe("available");

      const patchRes = await request(app)
        .patch(`/lessons/${lessonBId}`)
        .set("Authorization", `Bearer ${coach.accessToken}`)
        .send({ startsAt: slotMiddle });
      expect(patchRes.status).toBe(200);
      expect(patchRes.body.startsAt).toBe(slotMiddle);

      const lessonIdsToClean = await adminDb()
        .select({ id: lessons.id })
        .from(lessons)
        .where(and(eq(lessons.householdId, owner.householdId)));
      await cleanupLessons(lessonIdsToClean.map((row) => row.id));
    });
  });
});
