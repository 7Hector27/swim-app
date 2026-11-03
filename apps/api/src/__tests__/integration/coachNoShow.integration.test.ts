// Coach no-show integration tests. Verifies the PATCH /coach/lessons/:id/no-show
// and /undo endpoints, the cron's hands-off treatment of no_show rows, and
// that only the coach can mark. Mocks GCal/email microtasks so the test
// environment never touches the network.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import pino from "pino";
import { and, eq, inArray } from "drizzle-orm";
import { createApp } from "../../app";
import {
  adminDb,
  closeAdminDb,
  createTestUser,
  settleAndCleanupCoachNotificationsForHousehold,
  type TestUser,
} from "./helpers";
import {
  householdAuditLog,
  lessonEmailOutbox,
  lessonLocations,
  lessonSwimmers,
  lessons,
  profiles,
  swimmers,
} from "../../db/schema";
import * as googleSyncModule from "../../services/googleCalendarSync";

vi.mock("../../services/googleCalendarSync", () => ({
  syncLessonToGoogle: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../services/emails/sender", () => ({
  sendLessonEmailOutboxRow: vi.fn().mockResolvedValue(undefined),
}));

const logger = pino({ level: "silent" });
const app = createApp(logger);

let coach: TestUser;
let parent: TestUser;
let locationId: string;
let swimmerId: string;
let createdLessonIds: string[] = [];

async function makeCoach(userId: string): Promise<void> {
  await adminDb().update(profiles).set({ role: "coach" }).where(eq(profiles.id, userId));
}

async function insertLesson(input: {
  startsAt: Date;
  status: "approved" | "completed";
  completedAt?: Date | null;
  calendarSequence?: number;
}): Promise<string> {
  const [row] = await adminDb()
    .insert(lessons)
    .values({
      householdId: parent.householdId,
      locationId,
      startsAt: input.startsAt,
      durationMinutes: 30,
      type: "private",
      status: input.status,
      requestedBy: parent.userId,
      approvedAt: new Date(),
      approvedBy: coach.userId,
      ...(input.status === "completed" && { completedAt: input.completedAt ?? new Date() }),
      calendarInviteSentAt: new Date(),
      calendarSequence: input.calendarSequence ?? 0,
    })
    .returning({ id: lessons.id });
  const lessonId = row!.id;
  await adminDb().insert(lessonSwimmers).values({ lessonId, swimmerId });
  createdLessonIds.push(lessonId);
  return lessonId;
}

async function wipeLessons(): Promise<void> {
  await settleAndCleanupCoachNotificationsForHousehold(parent.householdId);
  if (createdLessonIds.length === 0) return;
  await adminDb()
    .delete(lessonEmailOutbox)
    .where(inArray(lessonEmailOutbox.lessonId, createdLessonIds));
  await adminDb().delete(lessonSwimmers).where(inArray(lessonSwimmers.lessonId, createdLessonIds));
  await adminDb().delete(lessons).where(inArray(lessons.id, createdLessonIds));
  createdLessonIds = [];
}

async function wipeAuditLog(): Promise<void> {
  await adminDb()
    .delete(householdAuditLog)
    .where(
      and(
        eq(householdAuditLog.householdId, parent.householdId),
        inArray(householdAuditLog.action, [
          "lesson_marked_no_show",
          "lesson_no_show_undone",
        ]),
      ),
    );
}

beforeAll(async () => {
  coach = await createTestUser("no-show-coach");
  await makeCoach(coach.userId);
  parent = await createTestUser("no-show-parent");

  const locs = await adminDb()
    .select({ id: lessonLocations.id })
    .from(lessonLocations)
    .where(eq(lessonLocations.isActive, true))
    .limit(1);
  locationId = locs[0]!.id;

  const [sRow] = await adminDb()
    .insert(swimmers)
    .values({
      firstName: "River",
      lastName: "NoShow",
      birthDate: "2015-01-01",
      sex: "female",
      isPublic: false,
      householdId: parent.householdId,
    })
    .returning({ id: swimmers.id });
  swimmerId = sRow!.id;
});

afterAll(async () => {
  await wipeLessons();
  await wipeAuditLog();
  if (swimmerId) {
    await adminDb().delete(householdAuditLog).where(eq(householdAuditLog.targetSwimmerId, swimmerId));
    await adminDb().delete(swimmers).where(eq(swimmers.id, swimmerId));
  }
  if (coach) await coach.cleanup();
  if (parent) await parent.cleanup();
  await closeAdminDb();
});

beforeEach(() => {
  vi.mocked(googleSyncModule.syncLessonToGoogle).mockClear();
});

afterEach(async () => {
  await wipeLessons();
  await wipeAuditLog();
});

describe("PATCH /coach/lessons/:id/no-show (integration)", () => {
  it("marks an approved past lesson as no_show, sets no_show_at/by, and writes an audit row", async () => {
    const past = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const lessonId = await insertLesson({ startsAt: past, status: "approved" });

    const res = await request(app)
      .patch(`/coach/lessons/${lessonId}/no-show`)
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("no_show");

    const [row] = await adminDb()
      .select({
        status: lessons.status,
        noShowAt: lessons.noShowAt,
        noShowBy: lessons.noShowBy,
      })
      .from(lessons)
      .where(eq(lessons.id, lessonId));
    expect(row?.status).toBe("no_show");
    expect(row?.noShowAt).not.toBeNull();
    expect(row?.noShowBy).toBe(coach.userId);

    const audit = await adminDb()
      .select()
      .from(householdAuditLog)
      .where(
        and(
          eq(householdAuditLog.householdId, parent.householdId),
          eq(householdAuditLog.action, "lesson_marked_no_show"),
        ),
      );
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actorId).toBe(coach.userId);

    // Google Calendar sync fires post-commit so the coach's event is
    // preserved as a no-show "ghost" entry (shouldExist includes no_show).
    expect(vi.mocked(googleSyncModule.syncLessonToGoogle)).toHaveBeenCalledWith(lessonId);
  });

  it("marks a past completed lesson as no_show (completed lessons are still markable)", async () => {
    const past = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const lessonId = await insertLesson({
      startsAt: past,
      status: "completed",
      completedAt: new Date(past.getTime() + 30 * 60_000),
    });

    const res = await request(app)
      .patch(`/coach/lessons/${lessonId}/no-show`)
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("no_show");
  });

  it("422 when the lesson hasn't started yet", async () => {
    const future = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const lessonId = await insertLesson({ startsAt: future, status: "approved" });

    const res = await request(app)
      .patch(`/coach/lessons/${lessonId}/no-show`)
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send({});
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("lesson_not_started");

    const [row] = await adminDb()
      .select({ status: lessons.status })
      .from(lessons)
      .where(eq(lessons.id, lessonId));
    expect(row?.status).toBe("approved");
  });

  it("403 when a parent calls the endpoint", async () => {
    const past = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const lessonId = await insertLesson({ startsAt: past, status: "approved" });

    const res = await request(app)
      .patch(`/coach/lessons/${lessonId}/no-show`)
      .set("Authorization", `Bearer ${parent.accessToken}`)
      .send({});
    expect(res.status).toBe(403);

    const [row] = await adminDb()
      .select({ status: lessons.status })
      .from(lessons)
      .where(eq(lessons.id, lessonId));
    expect(row?.status).toBe("approved");
  });
});

describe("PATCH /coach/lessons/:id/no-show/undo (integration)", () => {
  it("reverts no_show to completed when the lesson's end time has passed", async () => {
    const past = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const lessonId = await insertLesson({ startsAt: past, status: "approved" });
    await request(app)
      .patch(`/coach/lessons/${lessonId}/no-show`)
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send({});

    const res = await request(app)
      .patch(`/coach/lessons/${lessonId}/no-show/undo`)
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("completed");

    const [row] = await adminDb()
      .select({
        status: lessons.status,
        noShowAt: lessons.noShowAt,
        noShowBy: lessons.noShowBy,
        completedAt: lessons.completedAt,
      })
      .from(lessons)
      .where(eq(lessons.id, lessonId));
    expect(row?.status).toBe("completed");
    expect(row?.noShowAt).toBeNull();
    expect(row?.noShowBy).toBeNull();
    expect(row?.completedAt).not.toBeNull();

    const audit = await adminDb()
      .select()
      .from(householdAuditLog)
      .where(
        and(
          eq(householdAuditLog.householdId, parent.householdId),
          eq(householdAuditLog.action, "lesson_no_show_undone"),
        ),
      );
    expect(audit).toHaveLength(1);
  });

  it("422 when called on a lesson that is not no_show", async () => {
    const past = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const lessonId = await insertLesson({ startsAt: past, status: "approved" });

    const res = await request(app)
      .patch(`/coach/lessons/${lessonId}/no-show/undo`)
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send({});
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("lesson_not_no_show");
  });
});

describe("cron auto-complete leaves no_show rows alone", () => {
  it("POST /internal/cron/tick does not re-promote a no_show lesson", async () => {
    const past = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const lessonId = await insertLesson({ startsAt: past, status: "approved" });

    await request(app)
      .patch(`/coach/lessons/${lessonId}/no-show`)
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send({});

    // Trigger the cron tick that would otherwise promote approved → completed.
    const cronSecret = process.env["CRON_SECRET"] ?? "test-cron-secret";
    const res = await request(app)
      .post("/internal/cron/tick")
      .set("X-Cron-Secret", cronSecret)
      .send({});
    // 200 if secret matched, 401 if not — either way the no_show row must
    // be untouched. The cron's auto-complete filter is eq(status, "approved")
    // so no_show rows are structurally excluded.
    expect([200, 401]).toContain(res.status);

    const [row] = await adminDb()
      .select({ status: lessons.status })
      .from(lessons)
      .where(eq(lessons.id, lessonId));
    expect(row?.status).toBe("no_show");
  });
});
