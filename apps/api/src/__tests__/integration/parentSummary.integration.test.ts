// Tests for GET /swimmers/me/summary (parent dashboard summary).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import request from "supertest";
import pino from "pino";
import { randomUUID } from "node:crypto";
import { createApp } from "../../app";
import {
  adminDb,
  closeAdminDb,
  createTestUser,
  createTestUserInHousehold,
  hardDeleteSwimmer,
  settleAndCleanupCoachNotificationsForHousehold,
} from "./helpers";
import type { TestUser } from "./helpers";
import {
  evaluationSessions,
  lessonLocations,
  lessonSwimmers,
  lessons,
  meetSwims,
  meets,
  profiles,
  skillCategories,
  skills,
  skillRatings,
  swimmers,
} from "../../db/schema";

const logger = pino({ level: "silent" });
const app = createApp(logger);

let owner: TestUser;
let viewer: TestUser;
let otherHousehold: TestUser;
let coach: TestUser;

let locationId: string;
let aliceId: string;
let bobId: string;
let otherSwimmerId: string;
let coachProfileId: string;
let categoryId: string;
let skillId: string;
let meetId: string;

// A time guaranteed to be in the future even for a slow test run.
function futureIso(hoursFromNow: number): string {
  return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000).toISOString();
}

beforeAll(async () => {
  owner = await createTestUser("parent-summary-owner");
  viewer = await createTestUserInHousehold(
    "parent-summary-viewer",
    owner.householdId,
    "viewer",
  );
  otherHousehold = await createTestUser("parent-summary-other");
  coach = await createTestUser("parent-summary-coach");
  await adminDb()
    .update(profiles)
    .set({ role: "coach" })
    .where(eq(profiles.id, coach.userId));

  const locs = await adminDb()
    .select({ id: lessonLocations.id })
    .from(lessonLocations)
    .where(eq(lessonLocations.isActive, true))
    .limit(1);
  locationId = locs[0]!.id;

  // Owner's household has two active swimmers: Alice and Bob.
  const aliceRows = await adminDb()
    .insert(swimmers)
    .values({
      firstName: "Alice",
      lastName: "Summary",
      birthDate: "2015-01-01",
      sex: "female",
      isPublic: true,
      publicConsentAt: new Date(),
      publicConsentBy: owner.userId,
      householdId: owner.householdId,
    })
    .returning({ id: swimmers.id });
  aliceId = aliceRows[0]!.id;

  const bobRows = await adminDb()
    .insert(swimmers)
    .values({
      firstName: "Bob",
      lastName: "Summary",
      birthDate: "2016-03-15",
      sex: "male",
      isPublic: false,
      householdId: owner.householdId,
    })
    .returning({ id: swimmers.id });
  bobId = bobRows[0]!.id;

  // Other household has its own swimmer so we can verify no cross-household
  // leak.
  const otherRows = await adminDb()
    .insert(swimmers)
    .values({
      firstName: "Someone",
      lastName: "Else",
      birthDate: "2014-06-01",
      sex: "female",
      isPublic: false,
      householdId: otherHousehold.householdId,
    })
    .returning({ id: swimmers.id });
  otherSwimmerId = otherRows[0]!.id;

  // Three upcoming lessons for Alice (soonest), one for Bob (later). This is
  // the regression case: a plain "first N lessons" scan would miss Bob's
  // lesson entirely with any limit < 4 because every earlier lesson is on
  // Alice. DISTINCT ON (swimmer_id) handles it.
  const aliceLesson1 = await adminDb()
    .insert(lessons)
    .values({
      householdId: owner.householdId,
      locationId,
      startsAt: new Date(futureIso(24)),
      durationMinutes: 30,
      type: "private",
      status: "approved",
      requestedBy: owner.userId,
    })
    .returning({ id: lessons.id });
  await adminDb()
    .insert(lessonSwimmers)
    .values({ lessonId: aliceLesson1[0]!.id, swimmerId: aliceId });

  const aliceLesson2 = await adminDb()
    .insert(lessons)
    .values({
      householdId: owner.householdId,
      locationId,
      startsAt: new Date(futureIso(48)),
      durationMinutes: 30,
      type: "private",
      status: "approved",
      requestedBy: owner.userId,
    })
    .returning({ id: lessons.id });
  await adminDb()
    .insert(lessonSwimmers)
    .values({ lessonId: aliceLesson2[0]!.id, swimmerId: aliceId });

  const aliceLesson3 = await adminDb()
    .insert(lessons)
    .values({
      householdId: owner.householdId,
      locationId,
      startsAt: new Date(futureIso(72)),
      durationMinutes: 30,
      type: "private",
      status: "pending",
      requestedBy: owner.userId,
    })
    .returning({ id: lessons.id });
  await adminDb()
    .insert(lessonSwimmers)
    .values({ lessonId: aliceLesson3[0]!.id, swimmerId: aliceId });

  const bobLesson = await adminDb()
    .insert(lessons)
    .values({
      householdId: owner.householdId,
      locationId,
      startsAt: new Date(futureIso(96)),
      durationMinutes: 45,
      type: "private",
      status: "approved",
      requestedBy: owner.userId,
    })
    .returning({ id: lessons.id });
  await adminDb()
    .insert(lessonSwimmers)
    .values({ lessonId: bobLesson[0]!.id, swimmerId: bobId });

  // One past lesson for Alice to confirm it does NOT win over her next
  // upcoming lesson.
  const alicePast = await adminDb()
    .insert(lessons)
    .values({
      householdId: owner.householdId,
      locationId,
      startsAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
      durationMinutes: 30,
      type: "private",
      status: "approved",
      requestedBy: owner.userId,
      completedAt: new Date(),
    })
    .returning({ id: lessons.id });
  await adminDb()
    .insert(lessonSwimmers)
    .values({ lessonId: alicePast[0]!.id, swimmerId: aliceId });

  // Alice has an evaluation session with one non-voided rating → her
  // `lastEvaluatedOn` should surface. We need a skill and category.
  const category = await adminDb()
    .select({ id: skillCategories.id })
    .from(skillCategories)
    .limit(1);
  categoryId = category[0]!.id;

  const skillRows = await adminDb()
    .select({ id: skills.id })
    .from(skills)
    .limit(1);
  skillId = skillRows[0]!.id;

  coachProfileId = coach.userId;

  const sessionRows = await adminDb()
    .insert(evaluationSessions)
    .values({
      swimmerId: aliceId,
      coachId: coachProfileId,
      categoryId,
      screenSlug: "freestyle",
      sessionDate: "2026-10-20",
      context: "practice",
    })
    .returning({ id: evaluationSessions.id });
  await adminDb().insert(skillRatings).values({
    sessionId: sessionRows[0]!.id,
    swimmerId: aliceId,
    skillId,
    coachId: coachProfileId,
    grade: 3,
    ratedAt: new Date("2026-10-20T10:00:00Z"),
  });

  // Alice: three meet swims. Two 50-Free times across courses + one 100-Free.
  // The best 50 Free wins (32.14, SCY).
  meetId = randomUUID();
  await adminDb().insert(meets).values({
    id: meetId,
    name: "Summary Test Invitational",
    meetDate: "2026-09-15",
    course: "scy",
    createdBy: owner.userId,
  });

  await adminDb().insert(meetSwims).values([
    {
      swimmerId: aliceId,
      meetId,
      swimType: "meet",
      eventDistance: 50,
      eventStroke: "free",
      course: "scy",
      swumOn: "2026-09-15",
      timeHundredths: 3214,
      createdBy: owner.userId,
    },
    {
      swimmerId: aliceId,
      meetId,
      swimType: "meet",
      eventDistance: 50,
      eventStroke: "free",
      course: "scm",
      swumOn: "2026-09-15",
      timeHundredths: 3400,
      createdBy: owner.userId,
    },
    {
      swimmerId: aliceId,
      meetId,
      swimType: "meet",
      eventDistance: 100,
      eventStroke: "back",
      course: "scy",
      swumOn: "2026-09-15",
      timeHundredths: 8500,
      createdBy: owner.userId,
    },
  ]);
});

afterAll(async () => {
  // Cleanup lessons for both households.
  await settleAndCleanupCoachNotificationsForHousehold(owner.householdId);
  const ownerLessonRows = await adminDb()
    .select({ id: lessons.id })
    .from(lessons)
    .where(eq(lessons.householdId, owner.householdId));
  const ownerLessonIds = ownerLessonRows.map((row) => row.id);
  if (ownerLessonIds.length > 0) {
    await adminDb().delete(lessonSwimmers).where(inArray(lessonSwimmers.lessonId, ownerLessonIds));
    await adminDb().delete(lessons).where(inArray(lessons.id, ownerLessonIds));
  }

  await adminDb().delete(skillRatings).where(eq(skillRatings.swimmerId, aliceId));
  await adminDb().delete(evaluationSessions).where(eq(evaluationSessions.swimmerId, aliceId));
  await adminDb().delete(meetSwims).where(eq(meetSwims.swimmerId, aliceId));
  await adminDb().delete(meets).where(eq(meets.id, meetId));
  await hardDeleteSwimmer(aliceId);
  await hardDeleteSwimmer(bobId);
  await hardDeleteSwimmer(otherSwimmerId);
  await viewer.cleanup();
  await otherHousehold.cleanup();
  await coach.cleanup();
  await owner.cleanup();
  await closeAdminDb();
});

describe("GET /swimmers/me/summary", () => {
  it("returns the right next lesson for each swimmer even when earlier lessons all belong to one swimmer", async () => {
    const response = await request(app)
      .get("/swimmers/me/summary")
      .set("Authorization", `Bearer ${owner.accessToken}`);

    expect(response.status).toBe(200);
    const summaries = response.body.summaries as Array<{
      swimmerId: string;
      nextLesson: { startsAt: string; durationMinutes: number; locationName: string } | null;
      lastEvaluatedOn: string | null;
      bestEvent: { label: string; timeString: string } | null;
      onLeaderboards: boolean;
    }>;

    expect(summaries).toHaveLength(2);

    const alice = summaries.find((summary) => summary.swimmerId === aliceId);
    const bob = summaries.find((summary) => summary.swimmerId === bobId);
    expect(alice).toBeDefined();
    expect(bob).toBeDefined();

    // Alice's next lesson is her earliest upcoming (24h out), not the 48h or
    // 72h ones, and not the past one.
    expect(alice!.nextLesson).not.toBeNull();
    const aliceNextMs = new Date(alice!.nextLesson!.startsAt).getTime();
    const nowMs = Date.now();
    expect(aliceNextMs - nowMs).toBeGreaterThan(20 * 60 * 60 * 1000);
    expect(aliceNextMs - nowMs).toBeLessThan(30 * 60 * 60 * 1000);

    // Bob still gets his lesson (96h out) — the DISTINCT ON path means he is
    // not starved by Alice's three earlier lessons.
    expect(bob!.nextLesson).not.toBeNull();
    const bobNextMs = new Date(bob!.nextLesson!.startsAt).getTime();
    expect(bobNextMs - nowMs).toBeGreaterThan(90 * 60 * 60 * 1000);
    expect(bob!.nextLesson!.durationMinutes).toBe(45);

    // Last evaluated: Alice has one, Bob has none.
    expect(alice!.lastEvaluatedOn).toBe("2026-10-20");
    expect(bob!.lastEvaluatedOn).toBeNull();

    // Best event: Alice's fastest 50 Free is the SCY 32.14.
    expect(alice!.bestEvent).toEqual({ label: "50 Free", timeString: "32.14" });
    expect(bob!.bestEvent).toBeNull();

    // On leaderboards: Alice is public + has PBs; Bob is not public.
    expect(alice!.onLeaderboards).toBe(true);
    expect(bob!.onLeaderboards).toBe(false);
  });

  it("a parent in a different household never sees this household's data", async () => {
    const response = await request(app)
      .get("/swimmers/me/summary")
      .set("Authorization", `Bearer ${otherHousehold.accessToken}`);

    expect(response.status).toBe(200);
    const summaries = response.body.summaries as Array<{ swimmerId: string }>;

    // The other household has exactly one swimmer; owner's two swimmers must
    // not appear.
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.swimmerId).toBe(otherSwimmerId);
    const ids = summaries.map((summary) => summary.swimmerId);
    expect(ids).not.toContain(aliceId);
    expect(ids).not.toContain(bobId);
  });

  it("viewer (household member) can read the household summary", async () => {
    const response = await request(app)
      .get("/swimmers/me/summary")
      .set("Authorization", `Bearer ${viewer.accessToken}`);

    expect(response.status).toBe(200);
    const summaries = response.body.summaries as Array<{ swimmerId: string }>;
    const ids = summaries.map((summary) => summary.swimmerId);
    expect(ids).toContain(aliceId);
    expect(ids).toContain(bobId);
  });

  it("coach token is rejected (parent-only route)", async () => {
    const response = await request(app)
      .get("/swimmers/me/summary")
      .set("Authorization", `Bearer ${coach.accessToken}`);

    expect(response.status).toBe(403);
  });
});
