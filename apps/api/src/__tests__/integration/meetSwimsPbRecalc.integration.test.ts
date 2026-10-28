import { afterAll, afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import pino from "pino";
import { eq, inArray } from "drizzle-orm";
import { createApp } from "../../app";
import { meetSwims, meets, profiles } from "../../db/schema";
import { adminDb, closeAdminDb, createTestUser, hardDeleteSwimmer } from "./helpers";

const logger = pino({ level: "silent" });
const app = createApp(logger);

const createdSwimmerIds = new Set<string>();
const createdMeetIds = new Set<string>();

afterEach(async () => {
  // Meets have ON DELETE RESTRICT from meet_swims and from profiles.created_by.
  // Clean swims first, then the meets, then the swimmers; coach cleanup happens
  // last via createTestUser's cleanup fn.
  if (createdMeetIds.size > 0) {
    const meetIds = [...createdMeetIds];
    await adminDb().delete(meetSwims).where(inArray(meetSwims.meetId, meetIds));
    await adminDb().delete(meets).where(inArray(meets.id, meetIds));
    createdMeetIds.clear();
  }
  for (const swimmerId of createdSwimmerIds) {
    await hardDeleteSwimmer(swimmerId).catch(() => {});
  }
  createdSwimmerIds.clear();
});

afterAll(async () => {
  await closeAdminDb();
});

async function makeCoach(userId: string): Promise<void> {
  await adminDb().update(profiles).set({ role: "coach" }).where(eq(profiles.id, userId));
}

async function createParentSwimmer(accessToken: string): Promise<string> {
  const res = await request(app)
    .post("/swimmers")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({
      firstName: "PbRecalc",
      lastName: "Tester",
      birthDate: "2015-06-01",
      sex: "female" as const,
      isPublic: false,
      clubs: [],
    });
  expect(res.status).toBe(201);
  const swimmerId = res.body.id as string;
  createdSwimmerIds.add(swimmerId);
  return swimmerId;
}

async function createMeet(coachToken: string, name: string, meetDate: string): Promise<string> {
  const res = await request(app)
    .post("/coach/meets")
    .set("Authorization", `Bearer ${coachToken}`)
    .send({ name, meetDate, course: "scy" });
  expect(res.status).toBe(201);
  const meetId = res.body.id as string;
  createdMeetIds.add(meetId);
  return meetId;
}

async function recordSwim(
  coachToken: string,
  swimmerId: string,
  meetId: string,
  timeString: string,
  swumOn: string,
): Promise<string> {
  const res = await request(app)
    .post(`/coach/swimmers/${swimmerId}/meet-swims`)
    .set("Authorization", `Bearer ${coachToken}`)
    .send({
      swimType: "meet",
      meetId,
      eventDistance: 100,
      eventStroke: "free",
      course: "scy",
      timeString,
      swumOn,
    });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

async function fetchPb(coachToken: string, swimmerId: string): Promise<string | null> {
  const res = await request(app)
    .get(`/coach/swimmers/${swimmerId}/meet-swims`)
    .set("Authorization", `Bearer ${coachToken}`);
  expect(res.status).toBe(200);
  const pb = (res.body.personalBests as Array<{ timeString: string }>)[0];
  return pb?.timeString ?? null;
}

describe("meet swim PB recalculation after edit/delete", () => {
  it("recomputes PB when the current best is edited to a slower time", async () => {
    const parent = await createTestUser("pbrecalc-edit-parent");
    const coach = await createTestUser("pbrecalc-edit-coach");
    await makeCoach(coach.userId);

    try {
      const swimmerId = await createParentSwimmer(parent.accessToken);
      const meetId = await createMeet(coach.accessToken, "Edit Meet", "2025-06-01");

      await recordSwim(coach.accessToken, swimmerId, meetId, "1:00.00", "2025-06-02");
      const fastSwimId = await recordSwim(coach.accessToken, swimmerId, meetId, "58.00", "2025-06-02");

      expect(await fetchPb(coach.accessToken, swimmerId)).toBe("58.00");

      const patchRes = await request(app)
        .patch(`/coach/swimmers/${swimmerId}/meet-swims/${fastSwimId}`)
        .set("Authorization", `Bearer ${coach.accessToken}`)
        .send({ timeString: "1:02.00" });
      expect(patchRes.status).toBe(200);

      expect(await fetchPb(coach.accessToken, swimmerId)).toBe("1:00.00");
    } finally {
      // Clean up all meets created by this coach BEFORE deleting the coach,
      // or RESTRICT on meets.created_by will block the user delete.
      if (createdMeetIds.size > 0) {
        const meetIds = [...createdMeetIds];
        await adminDb().delete(meetSwims).where(inArray(meetSwims.meetId, meetIds));
        await adminDb().delete(meets).where(inArray(meets.id, meetIds));
        createdMeetIds.clear();
      }
      await parent.cleanup();
      await coach.cleanup();
    }
  });

  it("recomputes PB when the current best is deleted", async () => {
    const parent = await createTestUser("pbrecalc-delete-parent");
    const coach = await createTestUser("pbrecalc-delete-coach");
    await makeCoach(coach.userId);

    try {
      const swimmerId = await createParentSwimmer(parent.accessToken);
      const meetId = await createMeet(coach.accessToken, "Delete Meet", "2025-06-01");

      await recordSwim(coach.accessToken, swimmerId, meetId, "1:05.50", "2025-06-02");
      const bestSwimId = await recordSwim(coach.accessToken, swimmerId, meetId, "59.50", "2025-06-02");

      expect(await fetchPb(coach.accessToken, swimmerId)).toBe("59.50");

      const deleteRes = await request(app)
        .delete(`/coach/swimmers/${swimmerId}/meet-swims/${bestSwimId}`)
        .set("Authorization", `Bearer ${coach.accessToken}`);
      expect(deleteRes.status).toBe(204);

      expect(await fetchPb(coach.accessToken, swimmerId)).toBe("1:05.50");
    } finally {
      if (createdMeetIds.size > 0) {
        const meetIds = [...createdMeetIds];
        await adminDb().delete(meetSwims).where(inArray(meetSwims.meetId, meetIds));
        await adminDb().delete(meets).where(inArray(meets.id, meetIds));
        createdMeetIds.clear();
      }
      await parent.cleanup();
      await coach.cleanup();
    }
  });

  it("clears the PB when the only meet swim is deleted", async () => {
    const parent = await createTestUser("pbrecalc-last-parent");
    const coach = await createTestUser("pbrecalc-last-coach");
    await makeCoach(coach.userId);

    try {
      const swimmerId = await createParentSwimmer(parent.accessToken);
      const meetId = await createMeet(coach.accessToken, "Only Meet", "2025-06-01");

      const swimId = await recordSwim(coach.accessToken, swimmerId, meetId, "1:10.00", "2025-06-02");

      expect(await fetchPb(coach.accessToken, swimmerId)).toBe("1:10.00");

      await request(app)
        .delete(`/coach/swimmers/${swimmerId}/meet-swims/${swimId}`)
        .set("Authorization", `Bearer ${coach.accessToken}`)
        .expect(204);

      expect(await fetchPb(coach.accessToken, swimmerId)).toBeNull();
    } finally {
      if (createdMeetIds.size > 0) {
        const meetIds = [...createdMeetIds];
        await adminDb().delete(meetSwims).where(inArray(meetSwims.meetId, meetIds));
        await adminDb().delete(meets).where(inArray(meets.id, meetIds));
        createdMeetIds.clear();
      }
      await parent.cleanup();
      await coach.cleanup();
    }
  });
});
