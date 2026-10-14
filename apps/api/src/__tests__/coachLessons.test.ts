import { vi, describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import pino from "pino";

// ── IDs ───────────────────────────────────────────────────────────────────────

const COACH_PROFILE_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const PARENT_PROFILE_ID = "bbbbbbbb-0000-0000-0000-000000000002";
const HOUSEHOLD_ID = "ffffffff-0000-0000-0000-000000000010";
const LESSON_ID = "dddddddd-0000-0000-0000-000000000001";
const SWIMMER_ID = "cccccccc-0000-0000-0000-000000000001";
const LOCATION_ID = "eeeeeeee-0000-0000-0000-000000000001";

const now = new Date();
const futureStart = new Date(Date.now() + 48 * 60 * 60 * 1000);
const expiresAt = new Date(futureStart.getTime() - 16 * 60 * 60 * 1000);

// ── Mocks ─────────────────────────────────────────────────────────────────────

const { mockGetUser, mockDbSelect, mockDbInsert, mockDbUpdate, mockDbTransaction } =
  vi.hoisted(() => ({
    mockGetUser: vi.fn(),
    mockDbSelect: vi.fn(),
    mockDbInsert: vi.fn(),
    mockDbUpdate: vi.fn(),
    mockDbTransaction: vi.fn(),
  }));

vi.mock("../lib/supabase", () => ({
  supabase: { auth: { getUser: mockGetUser } },
}));

vi.mock("../db/client", () => ({
  db: {
    select: mockDbSelect,
    insert: mockDbInsert,
    update: mockDbUpdate,
    transaction: mockDbTransaction,
  },
}));

vi.mock("../lib/lessonApproval", () => ({
  needsApproval: vi.fn(),
  notifyBookingCreated: vi.fn(),
  notifyLessonApproved: vi.fn(),
  notifyLessonDeclined: vi.fn(),
  chargeLessonComplete: vi.fn(),
  syncCalendarApproved: vi.fn(),
}));

vi.mock("../lib/slots", () => ({
  computeAvailableSlots: vi.fn().mockReturnValue([]),
}));

import { createApp } from "../app";

const logger = pino({ level: "silent" });
const app = createApp(logger);

// ── Fixtures ──────────────────────────────────────────────────────────────────

const coachProfile = {
  id: COACH_PROFILE_ID,
  role: "coach" as const,
  fullName: "Coach Jason",
  phone: null,
  ageAttestedAt: now,
  disabledAt: null,
  createdAt: now,
  updatedAt: now,
};

const parentProfile = {
  id: PARENT_PROFILE_ID,
  role: "parent" as const,
  fullName: "Parent A",
  phone: null,
  ageAttestedAt: now,
  disabledAt: null,
  createdAt: now,
  updatedAt: now,
};

const pendingLessonRow = {
  id: LESSON_ID,
  householdId: HOUSEHOLD_ID,
  locationId: LOCATION_ID,
  startsAt: futureStart,
  durationMinutes: 30 as 30 | 45 | 60,
  type: "private" as const,
  status: "pending" as const,
  requestedBy: PARENT_PROFILE_ID,
  approvedAt: null as Date | null,
  approvedBy: null as string | null,
  declinedAt: null as Date | null,
  declinedBy: null as string | null,
  declineReason: null as string | null,
  canceledAt: null as Date | null,
  canceledBy: null as string | null,
  noShowAt: null as Date | null,
  noShowBy: null as string | null,
  completedAt: null as Date | null,
  expiresAt,
  googleCalendarEventId: null as string | null,
  calendarSyncStatus: "not_synced",
  calendarSyncError: null as string | null,
  calendarSyncAttempts: 0,
  createdAt: now,
  updatedAt: now,
};

type AnyProfile = { id: string; role: string; [key: string]: unknown };

function authAs(profile: AnyProfile) {
  mockGetUser.mockResolvedValue({
    data: { user: { id: profile.id, email: "user@example.com" } },
    error: null,
  });
}

function requireUserSelect(profile: AnyProfile) {
  const where = vi.fn().mockResolvedValue([profile]);
  return { from: vi.fn().mockReturnValue({ where }) };
}

// Coach routes pass through coachAvailabilityRouter.use(requireUser) AND
// coachLessonsRouter.use(requireUser), so we need two mocks per request.
function authAsCoach() {
  authAs(coachProfile);
  mockDbSelect
    .mockReturnValueOnce(requireUserSelect(coachProfile))  // coachAvailabilityRouter requireUser
    .mockReturnValueOnce(requireUserSelect(coachProfile)); // coachLessonsRouter requireUser
}


beforeEach(() => {
  vi.resetAllMocks();
});

// ── GET /coach/lessons ────────────────────────────────────────────────────────

describe("GET /coach/lessons", () => {
  it("returns lessons list", async () => {
    authAsCoach();

    // lazy-expiry update
    const updateWhere = vi.fn().mockResolvedValue([]);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    mockDbUpdate.mockReturnValueOnce({ set: updateSet });

    // lessons query
    const orderBy = vi.fn().mockResolvedValue([pendingLessonRow]);
    const where = vi.fn().mockReturnValue({ orderBy });
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where, orderBy }) });

    // swimmer join query
    const swimWhere = vi.fn().mockResolvedValue([{ lessonId: LESSON_ID, swimmerId: SWIMMER_ID, firstName: "Alice", lastName: "Smith" }]);
    const innerJoin = vi.fn().mockReturnValue({ where: swimWhere });
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockReturnValue({ innerJoin }) });

    const res = await request(app)
      .get("/coach/lessons")
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0]).toMatchObject({ id: LESSON_ID, status: "pending" });
    expect(res.body[0].swimmers).toHaveLength(1);
  });

  it("returns 403 for a parent", async () => {
    // Parent is rejected by coachAvailabilityRouter's requireCoach after requireUser.
    authAs(parentProfile);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(parentProfile));

    const res = await request(app)
      .get("/coach/lessons")
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(403);
  });
});

// ── PATCH /coach/lessons/:id/approve ─────────────────────────────────────────

describe("PATCH /coach/lessons/:id/approve", () => {
  it("approves a pending lesson", async () => {
    authAsCoach();

    const approvedRow = { ...pendingLessonRow, status: "approved" as const, approvedAt: now, approvedBy: COACH_PROFILE_ID };
    const returning = vi.fn().mockResolvedValue([approvedRow]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    mockDbUpdate.mockReturnValueOnce({ set });

    // swimmer fetch for response
    const swimWhere = vi.fn().mockResolvedValue([{ swimmerId: SWIMMER_ID, firstName: "Alice", lastName: "Smith" }]);
    const innerJoin = vi.fn().mockReturnValue({ where: swimWhere });
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockReturnValue({ innerJoin }) });

    const res = await request(app)
      .patch(`/coach/lessons/${LESSON_ID}/approve`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("approved");
    expect(res.body.approvedAt).not.toBeNull();
  });

  it("returns 404 when lesson does not exist", async () => {
    authAsCoach();

    // update returns nothing (lesson not found or not pending)
    const returning = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    mockDbUpdate.mockReturnValueOnce({ set });

    // existence check also returns nothing
    const existWhere = vi.fn().mockResolvedValue([]);
    const existLimit = vi.fn().mockResolvedValue([]);
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: existWhere.mockReturnValue({ limit: existLimit }) }) });

    const res = await request(app)
      .patch(`/coach/lessons/${LESSON_ID}/approve`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(404);
  });

  it("returns 403 when a parent tries to approve", async () => {
    // Parent rejected by coachAvailabilityRouter's requireCoach.
    authAs(parentProfile);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(parentProfile));

    const res = await request(app)
      .patch(`/coach/lessons/${LESSON_ID}/approve`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(403);
  });
});

// ── PATCH /coach/lessons/:id/decline ─────────────────────────────────────────

describe("PATCH /coach/lessons/:id/decline", () => {
  it("declines a pending lesson and stores the reason", async () => {
    authAsCoach();

    const declinedRow = {
      ...pendingLessonRow,
      status: "declined" as const,
      declinedAt: now,
      declinedBy: COACH_PROFILE_ID,
      declineReason: "Conflict",
    };
    const returning = vi.fn().mockResolvedValue([declinedRow]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    mockDbUpdate.mockReturnValueOnce({ set });

    // swimmer fetch
    const swimWhere = vi.fn().mockResolvedValue([{ swimmerId: SWIMMER_ID, firstName: "Alice", lastName: "Smith" }]);
    const innerJoin = vi.fn().mockReturnValue({ where: swimWhere });
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockReturnValue({ innerJoin }) });

    const res = await request(app)
      .patch(`/coach/lessons/${LESSON_ID}/decline`)
      .set("Authorization", "Bearer token")
      .send({ reason: "Conflict" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("declined");
    expect(res.body.declineReason).toBe("Conflict");
    expect(res.body.declinedAt).not.toBeNull();
  });

  it("returns 403 when a parent tries to decline", async () => {
    authAs(parentProfile);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(parentProfile)); // coachAvailabilityRouter requireUser; requireCoach rejects

    const res = await request(app)
      .patch(`/coach/lessons/${LESSON_ID}/decline`)
      .set("Authorization", "Bearer token")
      .send({});

    expect(res.status).toBe(403);
  });
});

// ── POST /internal/cron/tick ──────────────────────────────────────────────────

describe("POST /internal/cron/tick", () => {
  beforeEach(() => {
    process.env["CRON_SECRET"] = "test-cron-secret";
  });

  it("returns 401 without CRON_SECRET header", async () => {
    const res = await request(app).post("/internal/cron/tick");
    expect(res.status).toBe(401);
  });

  it("returns 401 with wrong CRON_SECRET", async () => {
    const res = await request(app)
      .post("/internal/cron/tick")
      .set("cron-secret", "wrong-secret");
    expect(res.status).toBe(401);
  });

  it("expires pending lessons past their deadline", async () => {
    const expiredRow = { id: LESSON_ID };
    mockDbTransaction.mockImplementationOnce(async (callback: (tx: unknown) => Promise<unknown>) => {
      const expireReturning = vi.fn().mockResolvedValue([expiredRow]);
      const expireWhere = vi.fn().mockReturnValue({ returning: expireReturning });
      const expireSet = vi.fn().mockReturnValue({ where: expireWhere });

      const completeReturning = vi.fn().mockResolvedValue([]);
      const completeWhere = vi.fn().mockReturnValue({ returning: completeReturning });
      const completeSet = vi.fn().mockReturnValue({ where: completeWhere });

      const tx = {
        update: vi.fn()
          .mockReturnValueOnce({ set: expireSet })
          .mockReturnValueOnce({ set: completeSet }),
      };
      return callback(tx);
    });

    const res = await request(app)
      .post("/internal/cron/tick")
      .set("cron-secret", "test-cron-secret");

    expect(res.status).toBe(200);
    expect(res.body.expired).toBe(1);
    expect(res.body.completed).toBe(0);
  });

  it("does not expire a lesson whose deadline has not passed", async () => {
    mockDbTransaction.mockImplementationOnce(async (callback: (tx: unknown) => Promise<unknown>) => {
      const returning = vi.fn().mockResolvedValue([]);
      const where = vi.fn().mockReturnValue({ returning });
      const set = vi.fn().mockReturnValue({ where });
      const tx = {
        update: vi.fn().mockReturnValue({ set }),
      };
      return callback(tx);
    });

    const res = await request(app)
      .post("/internal/cron/tick")
      .set("cron-secret", "test-cron-secret");

    expect(res.status).toBe(200);
    expect(res.body.expired).toBe(0);
    expect(res.body.completed).toBe(0);
  });
});

// ── GET /coach/schedule ───────────────────────────────────────────────────────

describe("GET /coach/schedule", () => {
  it("returns schedule items for the given date", async () => {
    authAsCoach();

    const lessonWithLocation = {
      ...pendingLessonRow,
      locationName: "Egret Park",
    };

    // lessons query: select({...}).from(lessons).innerJoin(lessonLocations, ...).where(and(...)).orderBy(asc(...))
    const lessonOrderBy = vi.fn().mockResolvedValue([lessonWithLocation]);
    const lessonWhere = vi.fn().mockReturnValue({ orderBy: lessonOrderBy });
    const lessonInnerJoin = vi.fn().mockReturnValue({ where: lessonWhere });
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockReturnValue({ innerJoin: lessonInnerJoin }) });

    // swimmer join: select({...}).from(lessonSwimmers).innerJoin(swimmers, ...).where(inArray(...))
    const swimWhere = vi.fn().mockResolvedValue([
      { lessonId: LESSON_ID, swimmerId: SWIMMER_ID, firstName: "Alice", lastName: "Smith" },
    ]);
    const swimInnerJoin = vi.fn().mockReturnValue({ where: swimWhere });
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockReturnValue({ innerJoin: swimInnerJoin }) });

    // Promise.all: [availabilityConfig.limit(1), travelBufferOverrides, blockedTimes, lessons.where(...), seasonSummerEndDates.where(...).limit(1)]
    const limitConfig = vi.fn().mockResolvedValue([]);  // no config → skip open slot computation
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockReturnValue({ limit: limitConfig }) });
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockResolvedValue([]) });
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockResolvedValue([]) });

    const existingWhere = vi.fn().mockResolvedValue([]);
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: existingWhere }) });

    const endDateLimit = vi.fn().mockResolvedValue([]);
    const endDateWhere = vi.fn().mockReturnValue({ limit: endDateLimit });
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: endDateWhere }) });

    const res = await request(app)
      .get("/coach/schedule?date=2025-09-15")
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ date: "2025-09-15" });
    expect(Array.isArray(res.body.items)).toBe(true);
    const lessonItem = res.body.items.find((item: { type: string }) => item.type === "lesson");
    expect(lessonItem).toBeDefined();
    expect(lessonItem.lesson.id).toBe(LESSON_ID);
  });

  it("returns 422 when date query param is missing", async () => {
    authAsCoach();

    const res = await request(app)
      .get("/coach/schedule")
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(422);
  });

  it("returns 403 for a parent", async () => {
    authAs(parentProfile);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(parentProfile));

    const res = await request(app)
      .get("/coach/schedule?date=2025-09-15")
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(403);
  });
});

// ── GET /coach/stats ──────────────────────────────────────────────────────────

describe("GET /coach/stats", () => {
  it("returns accurate counts", async () => {
    authAsCoach();

    const lessonWhere = vi.fn().mockResolvedValue([{ id: LESSON_ID }]);
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: lessonWhere }) });

    const weekWhere = vi.fn().mockResolvedValue([{ id: LESSON_ID }]);
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: weekWhere }) });

    const pendingWhere = vi.fn().mockResolvedValue([{ id: LESSON_ID }]);
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: pendingWhere }) });

    const swimmerWhere = vi.fn().mockResolvedValue([{ id: SWIMMER_ID }]);
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: swimmerWhere }) });

    const syncWhere = vi.fn().mockResolvedValue([]);
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: syncWhere }) });

    const res = await request(app)
      .get("/coach/stats")
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      lessonsToday: 1,
      lessonsThisWeek: 1,
      pendingRequests: 1,
      activeSwimmers: 1,
      calendarSyncFailures: 0,
    });
  });

  it("returns 403 for a parent", async () => {
    authAs(parentProfile);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(parentProfile));

    const res = await request(app)
      .get("/coach/stats")
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(403);
  });
});

// ── Lazy expiry in GET /coach/lessons ─────────────────────────────────────────

describe("lazy expiry in GET /coach/lessons", () => {
  it("expired lesson is returned as expired after the lazy update", async () => {
    authAsCoach();

    const expiredRow = { ...pendingLessonRow, status: "expired" as const };

    // lazy-expiry update
    const updateWhere = vi.fn().mockResolvedValue([{ id: LESSON_ID }]);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    mockDbUpdate.mockReturnValueOnce({ set: updateSet });

    // lessons query returns the now-expired row
    const orderBy = vi.fn().mockResolvedValue([expiredRow]);
    const where = vi.fn().mockReturnValue({ orderBy });
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where, orderBy }) });

    // swimmer join (empty — lesson already expired)
    const swimWhere = vi.fn().mockResolvedValue([]);
    const innerJoin = vi.fn().mockReturnValue({ where: swimWhere });
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockReturnValue({ innerJoin }) });

    const res = await request(app)
      .get("/coach/lessons?status=expired")
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    expect(res.body[0]?.status).toBe("expired");
  });
});
