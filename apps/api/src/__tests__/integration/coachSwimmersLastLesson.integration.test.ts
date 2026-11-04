// Integration tests for the "Last lesson" column on GET /coach/swimmers.
// Each test pins the clock so "most recent lesson that has already started"
// is deterministic. The clock is restored in afterAll so other suites keep
// wall-clock behavior.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import pino from "pino";
import { eq, inArray } from "drizzle-orm";

import { createApp } from "../../app";
import { adminDb, closeAdminDb, createTestUser, type TestUser } from "./helpers";
import {
  lessonLocations,
  lessonSwimmers,
  lessons,
  profiles,
  swimmers,
} from "../../db/schema";
import { __setClockForTests } from "../../lib/clock";

// Pinned to a weekday afternoon. All seeded lessons are expressed as offsets
// from PINNED_NOW so "future" / "past" are unambiguous regardless of DST.
const PINNED_NOW = new Date("2035-11-05T20:00:00.000Z");

const logger = pino({ level: "silent" });
const app = createApp(logger);

interface CoachSwimmerResponse {
  id: string;
  firstName: string;
  lastLesson: { id: string; startsAt: string } | null;
}

let owner: TestUser;
let coach: TestUser;
let locationId: string;
const createdSwimmerIds: string[] = [];
const createdLessonIds: string[] = [];

async function makeCoach(profileId: string): Promise<void> {
  await adminDb().update(profiles).set({ role: "coach" }).where(eq(profiles.id, profileId));
}

async function seedSwimmer(firstName: string): Promise<string> {
  const rows = await adminDb()
    .insert(swimmers)
    .values({
      firstName,
      lastName: "LastLessonTest",
      birthDate: "2015-06-01",
      sex: "female",
      isPublic: false,
      householdId: owner.householdId,
    })
    .returning({ id: swimmers.id });
  const id = rows[0]!.id;
  createdSwimmerIds.push(id);
  return id;
}

async function seedLesson(opts: {
  startsAt: Date;
  status: "pending" | "approved" | "declined" | "expired" | "canceled" | "no_show" | "completed";
  swimmerIds: string[];
}): Promise<string> {
  const rows = await adminDb()
    .insert(lessons)
    .values({
      householdId: owner.householdId,
      locationId,
      startsAt: opts.startsAt,
      durationMinutes: 30,
      type: "private",
      status: opts.status,
      requestedBy: owner.userId,
    })
    .returning({ id: lessons.id });
  const lessonId = rows[0]!.id;
  createdLessonIds.push(lessonId);
  for (const swimmerId of opts.swimmerIds) {
    await adminDb().insert(lessonSwimmers).values({ lessonId, swimmerId });
  }
  return lessonId;
}

async function fetchSwimmers(): Promise<CoachSwimmerResponse[]> {
  const res = await request(app)
    .get("/coach/swimmers")
    .set("Authorization", `Bearer ${coach.accessToken}`);
  expect(res.status).toBe(200);
  return res.body as CoachSwimmerResponse[];
}

function find(list: CoachSwimmerResponse[], id: string): CoachSwimmerResponse {
  const row = list.find((entry) => entry.id === id);
  if (!row) throw new Error(`swimmer ${id} missing from response`);
  return row;
}

beforeAll(async () => {
  owner = await createTestUser("last-lesson-owner");
  coach = await createTestUser("last-lesson-coach");
  await makeCoach(coach.userId);

  const locs = await adminDb()
    .select({ id: lessonLocations.id })
    .from(lessonLocations)
    .where(eq(lessonLocations.isActive, true))
    .limit(1);
  locationId = locs[0]?.id ?? "";
});

beforeEach(() => {
  __setClockForTests(PINNED_NOW);
});

afterEach(async () => {
  __setClockForTests(null);
  if (createdLessonIds.length > 0) {
    await adminDb()
      .delete(lessonSwimmers)
      .where(inArray(lessonSwimmers.lessonId, createdLessonIds));
    await adminDb().delete(lessons).where(inArray(lessons.id, createdLessonIds));
    createdLessonIds.length = 0;
  }
  if (createdSwimmerIds.length > 0) {
    await adminDb().delete(swimmers).where(inArray(swimmers.id, createdSwimmerIds));
    createdSwimmerIds.length = 0;
  }
});

afterAll(async () => {
  __setClockForTests(null);
  if (owner) await owner.cleanup();
  if (coach) await coach.cleanup();
  await closeAdminDb();
});

describe("GET /coach/swimmers — lastLesson", () => {
  it("picks the most recent past approved lesson and ignores a later future one", async () => {
    const swimmerId = await seedSwimmer("Past");
    const pastStart = new Date(PINNED_NOW.getTime() - 3 * 24 * 60 * 60 * 1000); // 3d ago
    const pastLessonId = await seedLesson({
      startsAt: pastStart,
      status: "approved",
      swimmerIds: [swimmerId],
    });
    // Future lesson exists on the same swimmer — must NOT win.
    await seedLesson({
      startsAt: new Date(PINNED_NOW.getTime() + 5 * 24 * 60 * 60 * 1000),
      status: "approved",
      swimmerIds: [swimmerId],
    });

    const row = find(await fetchSwimmers(), swimmerId);
    expect(row.lastLesson).not.toBeNull();
    expect(row.lastLesson!.id).toBe(pastLessonId);
    expect(row.lastLesson!.startsAt).toBe(pastStart.toISOString());
  });

  it("ignores a cancelled lesson even when it's the most recent", async () => {
    const swimmerId = await seedSwimmer("Cancelled");
    const earlierStart = new Date(PINNED_NOW.getTime() - 10 * 24 * 60 * 60 * 1000);
    const earlierId = await seedLesson({
      startsAt: earlierStart,
      status: "approved",
      swimmerIds: [swimmerId],
    });
    // A more recent cancelled lesson — should NOT win.
    await seedLesson({
      startsAt: new Date(PINNED_NOW.getTime() - 1 * 24 * 60 * 60 * 1000),
      status: "canceled",
      swimmerIds: [swimmerId],
    });

    const row = find(await fetchSwimmers(), swimmerId);
    expect(row.lastLesson?.id).toBe(earlierId);
  });

  it("ignores a no-show lesson even when it's the most recent", async () => {
    const swimmerId = await seedSwimmer("NoShow");
    const earlierStart = new Date(PINNED_NOW.getTime() - 10 * 24 * 60 * 60 * 1000);
    const earlierId = await seedLesson({
      startsAt: earlierStart,
      status: "completed",
      swimmerIds: [swimmerId],
    });
    await seedLesson({
      startsAt: new Date(PINNED_NOW.getTime() - 1 * 24 * 60 * 60 * 1000),
      status: "no_show",
      swimmerIds: [swimmerId],
    });

    const row = find(await fetchSwimmers(), swimmerId);
    expect(row.lastLesson?.id).toBe(earlierId);
  });

  it("counts a shared lesson for every swimmer on it", async () => {
    const siblingA = await seedSwimmer("SiblingA");
    const siblingB = await seedSwimmer("SiblingB");
    const sharedStart = new Date(PINNED_NOW.getTime() - 2 * 24 * 60 * 60 * 1000);
    const sharedLessonId = await seedLesson({
      startsAt: sharedStart,
      status: "approved",
      swimmerIds: [siblingA, siblingB],
    });

    const list = await fetchSwimmers();
    expect(find(list, siblingA).lastLesson?.id).toBe(sharedLessonId);
    expect(find(list, siblingB).lastLesson?.id).toBe(sharedLessonId);
  });

  it("returns lastLesson=null for a swimmer with no qualifying lessons", async () => {
    const swimmerId = await seedSwimmer("Fresh");
    // One future lesson so the swimmer isn't truly empty, but still not
    // eligible for last-lesson.
    await seedLesson({
      startsAt: new Date(PINNED_NOW.getTime() + 4 * 24 * 60 * 60 * 1000),
      status: "approved",
      swimmerIds: [swimmerId],
    });

    const row = find(await fetchSwimmers(), swimmerId);
    expect(row.lastLesson).toBeNull();
  });
});
