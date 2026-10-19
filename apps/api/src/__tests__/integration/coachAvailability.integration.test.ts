import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import pino from "pino";
import { eq } from "drizzle-orm";
import { createApp } from "../../app";
import {
  adminDb,
  closeAdminDb,
  createTestUser,
  hardDeleteSwimmer,
  type TestUser,
} from "./helpers";
import {
  availabilitySeasons,
  lessonLocations,
  lessonSwimmers,
  lessons,
  profiles,
  swimmers,
} from "../../db/schema";

const logger = pino({ level: "silent" });
const app = createApp(logger);

// ── Shared state ──────────────────────────────────────────────────────────────

let coach: TestUser;
let parent: TestUser;
let locationId: string;
let swimmerId: string;

// 2030-01-07 is a Monday (ISO weekday 1). We place the test lesson at
// 03:00 America/Los_Angeles — an off-hours slot Jason's seeded seasons do not
// cover, so after our test season is deleted the lesson's reason is
// deterministic regardless of what fallback season becomes active.
// 03:00 LA on 2030-01-07 == 11:00 UTC (PST, UTC-8).
const TEST_SEASON_START = "2030-01-01";
const TEST_LESSON_STARTS_AT = "2030-01-07T11:00:00.000Z";

const seasonIdsToClean = new Set<string>();
const lessonIdsToClean = new Set<string>();

beforeAll(async () => {
  coach = await createTestUser("coach-avail-coach");
  parent = await createTestUser("coach-avail-parent");
  await adminDb().update(profiles).set({ role: "coach" }).where(eq(profiles.id, coach.userId));

  const locs = await adminDb()
    .select({ id: lessonLocations.id })
    .from(lessonLocations)
    .where(eq(lessonLocations.isActive, true))
    .limit(1);
  locationId = locs[0]?.id ?? "";

  const swimmerRows = await adminDb()
    .insert(swimmers)
    .values({
      firstName: "Avail",
      lastName: "Test",
      birthDate: "2016-01-01",
      sex: "female",
      isPublic: false,
      householdId: parent.householdId,
    })
    .returning({ id: swimmers.id });
  swimmerId = swimmerRows[0]?.id ?? "";
});

afterEach(async () => {
  for (const lessonId of lessonIdsToClean) {
    await adminDb().delete(lessonSwimmers).where(eq(lessonSwimmers.lessonId, lessonId));
    await adminDb().delete(lessons).where(eq(lessons.id, lessonId));
  }
  lessonIdsToClean.clear();

  for (const seasonId of seasonIdsToClean) {
    await adminDb().delete(availabilitySeasons).where(eq(availabilitySeasons.id, seasonId));
  }
  seasonIdsToClean.clear();
});

afterAll(async () => {
  if (swimmerId) await hardDeleteSwimmer(swimmerId);
  if (parent) await parent.cleanup();
  if (coach) await coach.cleanup();
  await closeAdminDb();
});

async function insertTestSeason(name: string): Promise<string> {
  const rows = await adminDb()
    .insert(availabilitySeasons)
    .values({
      name,
      startDate: TEST_SEASON_START,
      endDate: "2030-12-31",
      teachesDays: [1],
      weekdayStartTime: "02:00:00",
      weekdayEndTime: "04:00:00",
      weekendStartTime: null,
      weekendEndTime: null,
      startsAtDst: false,
    })
    .returning({ id: availabilitySeasons.id });
  const id = rows[0]!.id;
  seasonIdsToClean.add(id);
  return id;
}

async function insertTestLesson(): Promise<string> {
  const rows = await adminDb()
    .insert(lessons)
    .values({
      householdId: parent.householdId,
      locationId,
      startsAt: new Date(TEST_LESSON_STARTS_AT),
      durationMinutes: 30,
      type: "private",
      status: "approved",
      requestedBy: parent.userId,
    })
    .returning({ id: lessons.id });
  const id = rows[0]!.id;
  await adminDb().insert(lessonSwimmers).values({ lessonId: id, swimmerId });
  lessonIdsToClean.add(id);
  return id;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("DELETE /coach/seasons/:id (integration)", () => {
  it("deleting a season does not warn about a lesson that was never in its hours", async () => {
    const seasonId = await insertTestSeason("Delete-me no-impact");

    const res = await request(app)
      .delete(`/coach/seasons/${seasonId}`)
      .set("Authorization", `Bearer ${coach.accessToken}`);

    expect(res.status).toBe(200);
    const body = res.body as { warnings: Array<{ lessonId: string }> };
    expect(Array.isArray(body.warnings)).toBe(true);
    // No lesson was placed in this season's hours; our test lesson doesn't exist
    // yet in this case, so warnings must not reference our test household.
    const householdLessonIds = (
      await adminDb()
        .select({ id: lessons.id })
        .from(lessons)
        .where(eq(lessons.householdId, parent.householdId))
    ).map((row) => row.id);
    for (const warning of body.warnings) {
      expect(householdLessonIds).not.toContain(warning.lessonId);
    }
    seasonIdsToClean.delete(seasonId); // already deleted via API
  });

  it("deleting a season that covered a booked lesson returns a warning for that lesson", async () => {
    const seasonId = await insertTestSeason("Delete-me with-impact");
    const lessonId = await insertTestLesson();

    const res = await request(app)
      .delete(`/coach/seasons/${seasonId}`)
      .set("Authorization", `Bearer ${coach.accessToken}`);

    expect(res.status).toBe(200);
    const body = res.body as {
      warnings: Array<{ lessonId: string; reason: string; swimmerFirstNames: string[] }>;
    };
    const ours = body.warnings.find((warning) => warning.lessonId === lessonId);
    expect(ours).toBeDefined();
    // After our season is removed, Jason's seeded seasons become active for this
    // 2030 date. They either close Monday (day_closed) or teach it with hours
    // that exclude 03:00 (outside_hours); either reason proves the lesson no
    // longer fits.
    expect(["day_closed", "outside_hours"]).toContain(ours?.reason);
    expect(ours?.swimmerFirstNames).toEqual(["Avail"]);
    seasonIdsToClean.delete(seasonId); // already deleted via API
  });
});
