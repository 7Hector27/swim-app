// Coach bulk cancel integration tests (ADR 033). Hits a real local Supabase
// stack; mocks only the post-commit microtasks so the test environment never
// reaches Google / SMTP. The transactional outbox + audit writes themselves
// are what we assert against.

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
  availabilityOverrides,
  blockedTimes,
  bulkCancellations,
  householdAuditLog,
  lessonEmailOutbox,
  lessonLocations,
  lessonSwimmers,
  lessons,
  profiles,
  swimmers,
} from "../../db/schema";
import * as googleSyncModule from "../../services/googleCalendarSync";
import { laToUtc } from "../../lib/slots";

vi.mock("../../services/googleCalendarSync", () => ({
  syncLessonToGoogle: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../services/emails/sender", () => ({
  sendLessonEmailOutboxRow: vi.fn().mockResolvedValue(undefined),
}));

const logger = pino({ level: "silent" });
const app = createApp(logger);

let coach: TestUser;
let parentA: TestUser;
let parentB: TestUser;
let primaryLocationId: string;
let secondaryLocationId: string;
let swimmerAId: string;
let swimmerBId: string;
let bookedLessonIds: string[] = [];

async function makeCoach(userId: string): Promise<void> {
  await adminDb().update(profiles).set({ role: "coach" }).where(eq(profiles.id, userId));
}

async function createLesson(input: {
  householdId: string;
  ownerUserId: string;
  locationId: string;
  startsAt: Date;
  status: "approved" | "pending";
  invited: boolean;
  swimmerId: string;
}): Promise<string> {
  const [row] = await adminDb()
    .insert(lessons)
    .values({
      householdId: input.householdId,
      locationId: input.locationId,
      startsAt: input.startsAt,
      durationMinutes: 30,
      type: "private",
      status: input.status,
      requestedBy: input.ownerUserId,
      ...(input.status === "approved" && { approvedAt: new Date(), approvedBy: coach.userId }),
      ...(input.status === "pending" && {
        expiresAt: new Date(input.startsAt.getTime() - 16 * 60 * 60 * 1000),
      }),
      ...(input.invited && input.status === "approved"
        ? { calendarInviteSentAt: new Date(), calendarSequence: 0 }
        : {}),
    })
    .returning({ id: lessons.id });
  const lessonId = row!.id;
  await adminDb().insert(lessonSwimmers).values({ lessonId, swimmerId: input.swimmerId });
  bookedLessonIds.push(lessonId);
  return lessonId;
}

async function wipeHouseholdLessons(householdId: string): Promise<void> {
  await settleAndCleanupCoachNotificationsForHousehold(householdId);
  const rows = await adminDb()
    .select({ id: lessons.id })
    .from(lessons)
    .where(eq(lessons.householdId, householdId));
  const ids = rows.map((row) => row.id);
  if (ids.length > 0) {
    await adminDb().delete(lessonEmailOutbox).where(inArray(lessonEmailOutbox.lessonId, ids));
    await adminDb().delete(lessonSwimmers).where(inArray(lessonSwimmers.lessonId, ids));
    await adminDb().delete(lessons).where(inArray(lessons.id, ids));
  }
}

async function wipeBulkArtifacts(): Promise<void> {
  // Clean up any bulk_cancel outbox rows + bulk_cancellations rows + audit rows.
  for (const householdId of [parentA?.householdId, parentB?.householdId].filter(Boolean) as string[]) {
    await adminDb()
      .delete(lessonEmailOutbox)
      .where(
        and(
          eq(lessonEmailOutbox.event, "coach_bulk_cancel"),
          eq(lessonEmailOutbox.householdId, householdId),
        ),
      );
    await adminDb()
      .delete(householdAuditLog)
      .where(
        and(
          eq(householdAuditLog.householdId, householdId),
          eq(householdAuditLog.action, "lessons_bulk_canceled_by_coach"),
        ),
      );
  }
  await adminDb().delete(bulkCancellations).where(eq(bulkCancellations.coachProfileId, coach.userId));
  await adminDb().delete(availabilityOverrides).where(eq(availabilityOverrides.note, "Bulk cancel"));
  await adminDb().delete(blockedTimes).where(eq(blockedTimes.note, "Bulk cancel"));
}

// A chosen test window ~90 days in the future, so pending lessons are not
// expired against the server clock. The bulk-cancel endpoint has no "past
// start time" rule, so even very near times would work, but a far-future
// window keeps the setup robust against clock skew.
function makeTestWindow(): { startDate: string; endDate: string; day: Date; nextDay: Date } {
  const base = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
  const day = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), 23, 0));
  const nextDay = new Date(day.getTime() + 24 * 60 * 60 * 1000);
  const yyyy = day.getUTCFullYear().toString().padStart(4, "0");
  const mm = (day.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = day.getUTCDate().toString().padStart(2, "0");
  const laDate = `${yyyy}-${mm}-${dd}`;
  const ny = nextDay.getUTCFullYear().toString().padStart(4, "0");
  const nm = (nextDay.getUTCMonth() + 1).toString().padStart(2, "0");
  const ndd = nextDay.getUTCDate().toString().padStart(2, "0");
  const endDate = `${ny}-${nm}-${ndd}`;
  return { startDate: laDate, endDate, day, nextDay };
}

beforeAll(async () => {
  coach = await createTestUser("bulk-cancel-coach");
  await makeCoach(coach.userId);
  parentA = await createTestUser("bulk-cancel-parentA");
  parentB = await createTestUser("bulk-cancel-parentB");

  const locs = await adminDb()
    .select({ id: lessonLocations.id, name: lessonLocations.name })
    .from(lessonLocations)
    .where(eq(lessonLocations.isActive, true));
  if (locs.length < 2) {
    throw new Error("Need at least two active named pools in the local DB for bulk cancel tests");
  }
  primaryLocationId = locs[0]!.id;
  secondaryLocationId = locs[1]!.id;

  const [sA] = await adminDb()
    .insert(swimmers)
    .values({
      firstName: "RiverA",
      lastName: "BulkA",
      birthDate: "2015-01-01",
      sex: "female",
      isPublic: false,
      householdId: parentA.householdId,
    })
    .returning({ id: swimmers.id });
  swimmerAId = sA!.id;

  const [sB] = await adminDb()
    .insert(swimmers)
    .values({
      firstName: "OceanB",
      lastName: "BulkB",
      birthDate: "2015-01-01",
      sex: "male",
      isPublic: false,
      householdId: parentB.householdId,
    })
    .returning({ id: swimmers.id });
  swimmerBId = sB!.id;
});

afterAll(async () => {
  await wipeBulkArtifacts();
  await wipeHouseholdLessons(parentA.householdId);
  await wipeHouseholdLessons(parentB.householdId);
  for (const sid of [swimmerAId, swimmerBId].filter(Boolean)) {
    await adminDb().delete(householdAuditLog).where(eq(householdAuditLog.targetSwimmerId, sid));
    await adminDb().delete(swimmers).where(eq(swimmers.id, sid));
  }
  if (coach) await coach.cleanup();
  if (parentA) await parentA.cleanup();
  if (parentB) await parentB.cleanup();
  await closeAdminDb();
});

beforeEach(() => {
  bookedLessonIds = [];
});

afterEach(async () => {
  vi.mocked(googleSyncModule.syncLessonToGoogle).mockClear();
  await wipeBulkArtifacts();
  await wipeHouseholdLessons(parentA.householdId);
  await wipeHouseholdLessons(parentB.householdId);
});

describe("POST /coach/lessons/bulk-cancel (integration)", () => {
  it("cancels lessons across two families and writes one outbox row per family", async () => {
    const window = makeTestWindow();
    // Two approved lessons for parent A, one approved for parent B, all on
    // the same LA day inside the window.
    const t1 = new Date(window.day.getTime() + 0 * 60 * 60 * 1000);
    const t2 = new Date(window.day.getTime() + 1 * 60 * 60 * 1000);
    const t3 = new Date(window.day.getTime() + 2 * 60 * 60 * 1000);
    const l1 = await createLesson({
      householdId: parentA.householdId,
      ownerUserId: parentA.userId,
      locationId: primaryLocationId,
      startsAt: t1,
      status: "approved",
      invited: true,
      swimmerId: swimmerAId,
    });
    const l2 = await createLesson({
      householdId: parentA.householdId,
      ownerUserId: parentA.userId,
      locationId: primaryLocationId,
      startsAt: t2,
      status: "approved",
      invited: false,
      swimmerId: swimmerAId,
    });
    const l3 = await createLesson({
      householdId: parentB.householdId,
      ownerUserId: parentB.userId,
      locationId: primaryLocationId,
      startsAt: t3,
      status: "approved",
      invited: true,
      swimmerId: swimmerBId,
    });

    const res = await request(app)
      .post("/coach/lessons/bulk-cancel")
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send({
        startDate: window.startDate,
        endDate: window.endDate,
        blockRange: false,
        message: "Pool closed for maintenance.",
      });
    expect(res.status).toBe(200);
    expect(res.body.canceledLessonCount).toBe(3);
    expect(res.body.declinedLessonCount).toBe(0);
    expect(res.body.affectedHouseholdCount).toBe(2);
    expect(res.body.blockApplied).toBe(false);

    const canceledRows = await adminDb()
      .select({ id: lessons.id, status: lessons.status })
      .from(lessons)
      .where(inArray(lessons.id, [l1, l2, l3]));
    expect(canceledRows.every((row) => row.status === "canceled")).toBe(true);

    // One outbox row per family, not per lesson. Scope to the test's
    // households so parallel test files writing coach_bulk_cancel rows
    // (e.g. coachBulkCancelRefund) don't inflate the count.
    const outboxRows = await adminDb()
      .select()
      .from(lessonEmailOutbox)
      .where(
        and(
          eq(lessonEmailOutbox.event, "coach_bulk_cancel"),
          inArray(lessonEmailOutbox.householdId, [parentA.householdId, parentB.householdId]),
        ),
      );
    expect(outboxRows).toHaveLength(2);
    const householdsEmailed = new Set(outboxRows.map((row) => row.householdId));
    expect(householdsEmailed.has(parentA.householdId)).toBe(true);
    expect(householdsEmailed.has(parentB.householdId)).toBe(true);

    // Each outbox row carries icsMethod='CANCEL' iff any lesson was invited.
    const parentARow = outboxRows.find((row) => row.householdId === parentA.householdId);
    const parentBRow = outboxRows.find((row) => row.householdId === parentB.householdId);
    expect(parentARow?.icsMethod).toBe("CANCEL");
    expect(parentBRow?.icsMethod).toBe("CANCEL");

    // Per-family audit rows written. Scope to this test's households for
    // the same reason as the outbox query above.
    const auditRows = await adminDb()
      .select()
      .from(householdAuditLog)
      .where(
        and(
          eq(householdAuditLog.action, "lessons_bulk_canceled_by_coach"),
          inArray(householdAuditLog.householdId, [parentA.householdId, parentB.householdId]),
        ),
      );
    expect(auditRows).toHaveLength(2);

    // Google sync fan-out: one call per cancelled approved lesson.
    expect(vi.mocked(googleSyncModule.syncLessonToGoogle)).toHaveBeenCalledTimes(3);
  });

  it("pool filter scopes cancellations to that pool only", async () => {
    const window = makeTestWindow();
    const t = new Date(window.day.getTime() + 0 * 60 * 60 * 1000);
    const inPool = await createLesson({
      householdId: parentA.householdId,
      ownerUserId: parentA.userId,
      locationId: primaryLocationId,
      startsAt: t,
      status: "approved",
      invited: true,
      swimmerId: swimmerAId,
    });
    const otherPool = await createLesson({
      householdId: parentA.householdId,
      ownerUserId: parentA.userId,
      locationId: secondaryLocationId,
      startsAt: new Date(t.getTime() + 60 * 60 * 1000),
      status: "approved",
      invited: true,
      swimmerId: swimmerAId,
    });

    const res = await request(app)
      .post("/coach/lessons/bulk-cancel")
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send({
        startDate: window.startDate,
        endDate: window.endDate,
        locationId: primaryLocationId,
        blockRange: false,
      });
    expect(res.status).toBe(200);
    expect(res.body.canceledLessonCount).toBe(1);

    const rows = await adminDb()
      .select({ id: lessons.id, status: lessons.status })
      .from(lessons)
      .where(inArray(lessons.id, [inPool, otherPool]));
    const byId = new Map(rows.map((row) => [row.id, row.status]));
    expect(byId.get(inPool)).toBe("canceled");
    expect(byId.get(otherPool)).toBe("approved");
  });

  it("declines pending requests with the coach's message and emits no request_declined row", async () => {
    const window = makeTestWindow();
    const pendingId = await createLesson({
      householdId: parentA.householdId,
      ownerUserId: parentA.userId,
      locationId: primaryLocationId,
      startsAt: new Date(window.day.getTime() + 60 * 60 * 1000),
      status: "pending",
      invited: false,
      swimmerId: swimmerAId,
    });

    const message = "Rebook anytime, no rush.";
    const res = await request(app)
      .post("/coach/lessons/bulk-cancel")
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send({
        startDate: window.startDate,
        endDate: window.endDate,
        message,
        blockRange: false,
      });
    expect(res.status).toBe(200);
    expect(res.body.canceledLessonCount).toBe(0);
    expect(res.body.declinedLessonCount).toBe(1);

    const [row] = await adminDb()
      .select({
        status: lessons.status,
        declinedBy: lessons.declinedBy,
        declineReason: lessons.declineReason,
      })
      .from(lessons)
      .where(eq(lessons.id, pendingId));
    expect(row?.status).toBe("declined");
    expect(row?.declinedBy).toBe(coach.userId);
    expect(row?.declineReason).toBe(message);

    // No request_declined outbox row for this lesson — the bulk email covers
    // the pending too. Scope by lesson id so unrelated rows elsewhere in the
    // test DB don't pollute the assertion.
    const declinedOutboxRows = await adminDb()
      .select()
      .from(lessonEmailOutbox)
      .where(
        and(
          eq(lessonEmailOutbox.event, "request_declined"),
          eq(lessonEmailOutbox.lessonId, pendingId),
        ),
      );
    expect(declinedOutboxRows).toHaveLength(0);

    // One coach_bulk_cancel row for parent A, carrying the declined request
    // in the declinedRequests list.
    const bulkRows = await adminDb()
      .select()
      .from(lessonEmailOutbox)
      .where(
        and(
          eq(lessonEmailOutbox.event, "coach_bulk_cancel"),
          eq(lessonEmailOutbox.householdId, parentA.householdId),
        ),
      );
    expect(bulkRows).toHaveLength(1);
    const payload = bulkRows[0]?.payload as {
      declinedRequests: Array<{ lessonId: string }>;
      message: string | null;
    };
    expect(payload.message).toBe(message);
    expect(payload.declinedRequests.map((r) => r.lessonId)).toEqual([pendingId]);
  });

  it("block option prevents rebooking in the range", async () => {
    const window = makeTestWindow();
    await createLesson({
      householdId: parentA.householdId,
      ownerUserId: parentA.userId,
      locationId: primaryLocationId,
      startsAt: new Date(window.day.getTime() + 60 * 60 * 1000),
      status: "approved",
      invited: false,
      swimmerId: swimmerAId,
    });

    const res = await request(app)
      .post("/coach/lessons/bulk-cancel")
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send({
        startDate: window.startDate,
        endDate: window.endDate,
        locationId: primaryLocationId,
        blockRange: true,
      });
    expect(res.status).toBe(200);
    expect(res.body.blockApplied).toBe(true);

    // Pool-filtered block writes blocked_times rows, not an override.
    const blockRows = await adminDb()
      .select({ locationId: blockedTimes.locationId, note: blockedTimes.note })
      .from(blockedTimes)
      .where(eq(blockedTimes.note, "Bulk cancel"));
    expect(blockRows.length).toBeGreaterThan(0);
    for (const row of blockRows) {
      expect(row.locationId).toBe(primaryLocationId);
    }
  });

  it("block option without a pool writes a day_off override", async () => {
    const window = makeTestWindow();
    await createLesson({
      householdId: parentA.householdId,
      ownerUserId: parentA.userId,
      locationId: primaryLocationId,
      startsAt: new Date(window.day.getTime() + 60 * 60 * 1000),
      status: "approved",
      invited: false,
      swimmerId: swimmerAId,
    });

    const res = await request(app)
      .post("/coach/lessons/bulk-cancel")
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send({
        startDate: window.startDate,
        endDate: window.endDate,
        blockRange: true,
      });
    expect(res.status).toBe(200);
    expect(res.body.blockApplied).toBe(true);

    const overrideRows = await adminDb()
      .select()
      .from(availabilityOverrides)
      .where(eq(availabilityOverrides.note, "Bulk cancel"));
    expect(overrideRows.length).toBeGreaterThan(0);
    expect(overrideRows[0]?.kind).toBe("day_off");
    expect(overrideRows[0]?.startDate).toBe(window.startDate);
    expect(overrideRows[0]?.endDate).toBe(window.endDate);
  });

  it("empty confirm (no lessons, blockRange off) rolls back the bulk_cancellations row", async () => {
    const window = makeTestWindow();
    // No lessons created — the range is empty.
    const before = await adminDb()
      .select({ id: bulkCancellations.id })
      .from(bulkCancellations)
      .where(eq(bulkCancellations.coachProfileId, coach.userId));

    const res = await request(app)
      .post("/coach/lessons/bulk-cancel")
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send({
        startDate: window.startDate,
        endDate: window.endDate,
        blockRange: false,
      });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("no_lessons_in_range");

    const after = await adminDb()
      .select({ id: bulkCancellations.id })
      .from(bulkCancellations)
      .where(eq(bulkCancellations.coachProfileId, coach.userId));
    // The empty-case sentinel rolls back the whole transaction, so the
    // bulk_cancellations parent row inserted inside the tx never commits.
    expect(after).toHaveLength(before.length);
  });

  it("rejects start_date in the past with 422 start_date_in_past", async () => {
    // Two days ago — well before "today in LA" regardless of the test
    // runner's clock skew or current UTC-vs-LA calendar-date boundary.
    const past = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const pastDate = `${past.getUTCFullYear()}-${String(past.getUTCMonth() + 1).padStart(2, "0")}-${String(past.getUTCDate()).padStart(2, "0")}`;

    const res = await request(app)
      .post("/coach/lessons/bulk-cancel")
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send({
        startDate: pastDate,
        endDate: pastDate,
        blockRange: false,
      });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("start_date_in_past");

    const bulkRows = await adminDb()
      .select({ id: bulkCancellations.id })
      .from(bulkCancellations)
      .where(eq(bulkCancellations.coachProfileId, coach.userId));
    expect(bulkRows).toHaveLength(0);
  });

  it("rejects a range longer than 90 days with 422 range_too_large", async () => {
    const window = makeTestWindow();
    // Build an endDate 90 days past window.startDate (91 inclusive days).
    const start = window.startDate;
    const [y, m, d] = start.split("-").map((n) => Number.parseInt(n, 10));
    const endUtc = new Date(Date.UTC(y!, m! - 1, d!));
    endUtc.setUTCDate(endUtc.getUTCDate() + 90);
    const tooLargeEnd = `${endUtc.getUTCFullYear()}-${String(endUtc.getUTCMonth() + 1).padStart(2, "0")}-${String(endUtc.getUTCDate()).padStart(2, "0")}`;

    const res = await request(app)
      .post("/coach/lessons/bulk-cancel")
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send({
        startDate: start,
        endDate: tooLargeEnd,
        blockRange: false,
      });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("range_too_large");

    const bulkRows = await adminDb()
      .select({ id: bulkCancellations.id })
      .from(bulkCancellations)
      .where(eq(bulkCancellations.coachProfileId, coach.userId));
    expect(bulkRows).toHaveLength(0);
  });

  it("parent cannot call the endpoint (403)", async () => {
    const window = makeTestWindow();
    const res = await request(app)
      .post("/coach/lessons/bulk-cancel")
      .set("Authorization", `Bearer ${parentA.accessToken}`)
      .send({
        startDate: window.startDate,
        endDate: window.endDate,
        blockRange: false,
      });
    expect(res.status).toBe(403);
  });

  // ── Time window overlap + per-day block (ADR 033 extension) ────────────────

  it("time window: cancels a lesson overlapping the window edge, skips one just outside", async () => {
    const window = makeTestWindow();
    // Window: 16:00 LA to 17:00 LA on the test day.
    const windowStart = "16:00";
    const windowEnd = "17:00";
    const overlapsEdge = await createLesson({
      householdId: parentA.householdId,
      ownerUserId: parentA.userId,
      locationId: primaryLocationId,
      // 15:45 LA, 30 min → ends 16:15, overlaps 16:00 start.
      startsAt: laToUtc(window.startDate, "15:45"),
      status: "approved",
      invited: true,
      swimmerId: swimmerAId,
    });
    const insideWindow = await createLesson({
      householdId: parentA.householdId,
      ownerUserId: parentA.userId,
      locationId: primaryLocationId,
      startsAt: laToUtc(window.startDate, "16:30"),
      status: "approved",
      invited: false,
      swimmerId: swimmerAId,
    });
    const justBefore = await createLesson({
      householdId: parentA.householdId,
      ownerUserId: parentA.userId,
      locationId: primaryLocationId,
      // 15:00 LA, 30 min → ends 15:30, strictly before window.
      startsAt: laToUtc(window.startDate, "15:00"),
      status: "approved",
      invited: false,
      swimmerId: swimmerAId,
    });
    const boundaryTouch = await createLesson({
      householdId: parentA.householdId,
      ownerUserId: parentA.userId,
      locationId: primaryLocationId,
      // 17:00 LA, 30 min → starts exactly at window end. Strict overlap:
      // not cancelled.
      startsAt: laToUtc(window.startDate, "17:00"),
      status: "approved",
      invited: false,
      swimmerId: swimmerAId,
    });

    const res = await request(app)
      .post("/coach/lessons/bulk-cancel")
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send({
        startDate: window.startDate,
        endDate: window.startDate,
        startTime: windowStart,
        endTime: windowEnd,
        blockRange: false,
      });
    expect(res.status).toBe(200);
    expect(res.body.canceledLessonCount).toBe(2);

    const rows = await adminDb()
      .select({ id: lessons.id, status: lessons.status })
      .from(lessons)
      .where(inArray(lessons.id, [overlapsEdge, insideWindow, justBefore, boundaryTouch]));
    const byId = new Map(rows.map((row) => [row.id, row.status]));
    expect(byId.get(overlapsEdge)).toBe("canceled");
    expect(byId.get(insideWindow)).toBe("canceled");
    expect(byId.get(justBefore)).toBe("approved");
    expect(byId.get(boundaryTouch)).toBe("approved");
  });

  it("time window: multi-day range writes per-day blocked_times for only the window", async () => {
    const window = makeTestWindow();
    const nextLaDate = (() => {
      const [y, m, d] = window.startDate.split("-").map((n) => Number.parseInt(n, 10));
      const next = new Date(Date.UTC(y!, m! - 1, d!));
      next.setUTCDate(next.getUTCDate() + 1);
      const yy = next.getUTCFullYear().toString().padStart(4, "0");
      const mm = (next.getUTCMonth() + 1).toString().padStart(2, "0");
      const dd = next.getUTCDate().toString().padStart(2, "0");
      return `${yy}-${mm}-${dd}`;
    })();

    const res = await request(app)
      .post("/coach/lessons/bulk-cancel")
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send({
        startDate: window.startDate,
        endDate: nextLaDate,
        locationId: primaryLocationId,
        startTime: "16:00",
        endTime: "17:00",
        blockRange: true,
      });
    expect(res.status).toBe(200);
    expect(res.body.blockApplied).toBe(true);

    const blockRows = await adminDb()
      .select({
        startsAt: blockedTimes.startsAt,
        endsAt: blockedTimes.endsAt,
        locationId: blockedTimes.locationId,
        note: blockedTimes.note,
      })
      .from(blockedTimes)
      .where(eq(blockedTimes.note, "Bulk cancel"))
      .orderBy(blockedTimes.startsAt);
    expect(blockRows).toHaveLength(2);
    // Day 1: 16:00-17:00 LA.
    expect(blockRows[0]?.startsAt.toISOString()).toBe(laToUtc(window.startDate, "16:00").toISOString());
    expect(blockRows[0]?.endsAt.toISOString()).toBe(laToUtc(window.startDate, "17:00").toISOString());
    expect(blockRows[0]?.locationId).toBe(primaryLocationId);
    // Day 2: 16:00-17:00 LA.
    expect(blockRows[1]?.startsAt.toISOString()).toBe(laToUtc(nextLaDate, "16:00").toISOString());
    expect(blockRows[1]?.endsAt.toISOString()).toBe(laToUtc(nextLaDate, "17:00").toISOString());
    expect(blockRows[1]?.locationId).toBe(primaryLocationId);
  });

  it("time window: parent available-range marks slots inside the block unavailable but keeps slots outside available", async () => {
    const window = makeTestWindow();
    const laDate = window.startDate;
    await request(app)
      .post("/coach/lessons/bulk-cancel")
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send({
        startDate: laDate,
        endDate: laDate,
        locationId: primaryLocationId,
        startTime: "16:00",
        endTime: "17:00",
        blockRange: true,
      });

    const res = await request(app)
      .get("/lessons/available-range")
      .set("Authorization", `Bearer ${parentA.accessToken}`)
      .query({
        view: "week",
        date: laDate,
        durationMinutes: "30",
        locationId: primaryLocationId,
      });
    expect(res.status).toBe(200);
    const body = res.body as { days: Array<{ date: string; slots: Array<{ startsAt: string; state: string }> }> };
    const day = body.days.find((d) => d.date === laDate);
    expect(day).toBeDefined();
    // A slot at 16:15 LA sits inside the block.
    const insideSlotStart = laToUtc(laDate, "16:15").toISOString();
    const insideSlot = day!.slots.find((slot) => slot.startsAt === insideSlotStart);
    if (insideSlot) {
      expect(insideSlot.state).toBe("unavailable");
    }
    // 17:00 LA sits at the block's end. The slot engine treats boundary as
    // open: expect an "available" (or non-unavailable) state.
    const edgeSlotStart = laToUtc(laDate, "17:00").toISOString();
    const edgeSlot = day!.slots.find((slot) => slot.startsAt === edgeSlotStart);
    if (edgeSlot) {
      expect(edgeSlot.state).not.toBe("unavailable");
    }
  });

  it("time window: whole-day (no times) still writes the pre-extension artifact", async () => {
    const window = makeTestWindow();
    const res = await request(app)
      .post("/coach/lessons/bulk-cancel")
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send({
        startDate: window.startDate,
        endDate: window.startDate,
        locationId: primaryLocationId,
        blockRange: true,
      });
    expect(res.status).toBe(200);

    const blockRows = await adminDb()
      .select({ startsAt: blockedTimes.startsAt, endsAt: blockedTimes.endsAt })
      .from(blockedTimes)
      .where(eq(blockedTimes.note, "Bulk cancel"));
    expect(blockRows).toHaveLength(1);
    // Covers midnight to next midnight LA.
    expect(blockRows[0]?.startsAt.toISOString()).toBe(laToUtc(window.startDate, "00:00").toISOString());
    const [y, m, d] = window.startDate.split("-").map((n) => Number.parseInt(n, 10));
    const nextDay = new Date(Date.UTC(y!, m! - 1, d!));
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const yy = nextDay.getUTCFullYear().toString().padStart(4, "0");
    const mm = (nextDay.getUTCMonth() + 1).toString().padStart(2, "0");
    const dd = nextDay.getUTCDate().toString().padStart(2, "0");
    const nextLaDate = `${yy}-${mm}-${dd}`;
    expect(blockRows[0]?.endsAt.toISOString()).toBe(laToUtc(nextLaDate, "00:00").toISOString());
  });

  it("preview endpoint returns the same shape with no state change", async () => {
    const window = makeTestWindow();
    const t = new Date(window.day.getTime() + 60 * 60 * 1000);
    await createLesson({
      householdId: parentA.householdId,
      ownerUserId: parentA.userId,
      locationId: primaryLocationId,
      startsAt: t,
      status: "approved",
      invited: true,
      swimmerId: swimmerAId,
    });

    const res = await request(app)
      .post("/coach/lessons/bulk-cancel/preview")
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send({
        startDate: window.startDate,
        endDate: window.endDate,
      });
    expect(res.status).toBe(200);
    expect(res.body.approvedCount).toBe(1);
    expect(res.body.pendingCount).toBe(0);
    expect(res.body.householdCount).toBe(1);
    expect(res.body.lessons).toHaveLength(1);

    // Preview does not mutate anything.
    const stillApproved = await adminDb()
      .select({ status: lessons.status })
      .from(lessons)
      .where(eq(lessons.householdId, parentA.householdId));
    expect(stillApproved.every((row) => row.status === "approved")).toBe(true);
  });
});
