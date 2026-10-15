import { vi, describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import pino from "pino";

// ── IDs ───────────────────────────────────────────────────────────────────────

const COACH_PROFILE_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const PARENT_PROFILE_ID = "bbbbbbbb-0000-0000-0000-000000000002";
const HOUSEHOLD_ID = "ffffffff-0000-0000-0000-000000000010";
const LESSON_ID = "dddddddd-0000-0000-0000-000000000001";
const LESSON_ID_B = "dddddddd-0000-0000-0000-000000000002";
const SWIMMER_ID = "cccccccc-0000-0000-0000-000000000001";
const LOCATION_ID = "eeeeeeee-0000-0000-0000-000000000001";
const LOCATION_ID_B = "eeeeeeee-0000-0000-0000-000000000002";

// Frozen clock: Mon 2026-11-02 at noon PST = 20:00 UTC.
// At 20:00 UTC the UTC weekday equals the LA calendar day (both PST and PDT).
const ANCHOR_NOW = new Date("2026-11-02T20:00:00.000Z");

const now = ANCHOR_NOW;

// Returns the first weekday (UTC day 1–5) that is ≥ minHours after `from`.
function nextLessonDay(from: Date, minHours: number): Date {
  const candidate = new Date(from.getTime() + minHours * 60 * 60 * 1000);
  while (candidate.getUTCDay() === 0 || candidate.getUTCDay() === 6) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }
  return candidate;
}

const futureStart = nextLessonDay(ANCHOR_NOW, 48);
const expiresAt = new Date(futureStart.getTime() - 16 * 60 * 60 * 1000);

// ── Mocks ─────────────────────────────────────────────────────────────────────

const {
  mockGetUser,
  mockDbSelect,
  mockDbInsert,
  mockDbUpdate,
  mockDbTransaction,
  mockComputeSlots,
  mockMergeSlotWindows,
} = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockDbSelect: vi.fn(),
  mockDbInsert: vi.fn(),
  mockDbUpdate: vi.fn(),
  mockDbTransaction: vi.fn(),
  mockComputeSlots: vi.fn(),
  mockMergeSlotWindows: vi.fn(),
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
  computeAvailableSlots: mockComputeSlots,
  mergeSlotWindows: mockMergeSlotWindows,
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

const configRow = {
  id: "config-id-0000-0000-0000-000000000001",
  lessonDays: [1, 2, 3, 5],
  schoolYearStartTime: "16:30",
  schoolYearEndTime: "20:30",
  summerMorningStartTime: "09:00",
  summerMorningEndTime: "12:00",
  summerEveningStartTime: "19:00",
  summerEveningEndTime: "21:00",
  maxDailyLessonMinutes: 240,
  bookingMinAdvanceHours: 16,
  bookingMaxAdvanceWeeks: 10,
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


beforeAll(() => {
  vi.useFakeTimers({ now: ANCHOR_NOW });
});

afterAll(() => {
  vi.useRealTimers();
});

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

// ── GET /coach/schedule ───────────────────────────────────────────────────────

describe("GET /coach/schedule", () => {
  it("returns lesson, travel_buffer, and open_slot items", async () => {
    authAsCoach();

    const lessonA = {
      id: LESSON_ID,
      householdId: HOUSEHOLD_ID,
      locationId: LOCATION_ID,
      locationName: "Egret Park",
      startsAt: new Date("2025-09-15T21:30:00.000Z"), // 2:30 PM LA
      durationMinutes: 30,
      type: "private" as const,
      status: "approved" as const,
      expiresAt: null as Date | null,
      approvedAt: new Date("2025-09-14T00:00:00.000Z") as Date | null,
      declinedAt: null as Date | null,
      declineReason: null as string | null,
      createdAt: now,
    };

    const lessonB = {
      id: LESSON_ID_B,
      householdId: HOUSEHOLD_ID,
      locationId: LOCATION_ID_B,
      locationName: "Stonegate",
      startsAt: new Date("2025-09-15T23:30:00.000Z"), // 4:30 PM LA
      durationMinutes: 30,
      type: "private" as const,
      status: "approved" as const,
      expiresAt: null as Date | null,
      approvedAt: new Date("2025-09-14T00:00:00.000Z") as Date | null,
      declinedAt: null as Date | null,
      declineReason: null as string | null,
      createdAt: now,
    };

    // 1. lessons + innerJoin(lessonLocations) .where(...).orderBy()
    const lessonsOrderBy = vi.fn().mockResolvedValue([lessonA, lessonB]);
    const lessonsWhere = vi.fn().mockReturnValue({ orderBy: lessonsOrderBy });
    const lessonsInnerJoin = vi.fn().mockReturnValue({ where: lessonsWhere });
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockReturnValue({ innerJoin: lessonsInnerJoin }) });

    // 2. lessonSwimmers + innerJoin(swimmers) .where()
    const swimmerWhere = vi.fn().mockResolvedValue([
      { lessonId: LESSON_ID, swimmerId: SWIMMER_ID, firstName: "Alice", lastName: "Smith" },
    ]);
    const swimmerInnerJoin = vi.fn().mockReturnValue({ where: swimmerWhere });
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockReturnValue({ innerJoin: swimmerInnerJoin }) });

    // 3. Promise.all of 5 selects: [configRows, bufferRows, blockedRows, existingLessonRows, endDateRow]
    // configRows
    const configLimit = vi.fn().mockResolvedValue([configRow]);
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockReturnValue({ limit: configLimit }) });
    // travelBufferOverrides
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockResolvedValue([]) });
    // blockedTimes
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockResolvedValue([]) });
    // existingLessonRows with .where()
    const existingWhere = vi.fn().mockResolvedValue([
      { startsAt: lessonA.startsAt, durationMinutes: 30, locationId: LOCATION_ID },
      { startsAt: lessonB.startsAt, durationMinutes: 30, locationId: LOCATION_ID_B },
    ]);
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: existingWhere }) });
    // seasonSummerEndDates
    const endDateWhere = vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) });
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: endDateWhere }) });

    // 4. namedPoolRows for open slot computation
    const poolWhere = vi.fn().mockResolvedValue([{ id: LOCATION_ID }, { id: LOCATION_ID_B }]);
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: poolWhere }) });

    // computeAvailableSlots returns one slot per pool
    const openSlot1 = { startsAt: new Date("2025-09-16T00:00:00.000Z"), endsAt: new Date("2025-09-16T00:30:00.000Z") };
    const openSlot2 = { startsAt: new Date("2025-09-16T01:00:00.000Z"), endsAt: new Date("2025-09-16T01:30:00.000Z") };
    mockComputeSlots
      .mockReturnValueOnce([openSlot1])
      .mockReturnValueOnce([openSlot2]);
    // mergeSlotWindows returns the combined slots
    mockMergeSlotWindows.mockReturnValueOnce([openSlot1, openSlot2]);

    const res = await request(app)
      .get("/coach/schedule?date=2025-09-15")
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    const types = res.body.map((item: { type: string }) => item.type);
    expect(types).toContain("lesson");
    expect(types).toContain("travel_buffer");
    expect(types).toContain("open_slot");

    const lessonItems = res.body.filter((item: { type: string }) => item.type === "lesson");
    expect(lessonItems).toHaveLength(2);
    expect(lessonItems[0].lesson.id).toBe(LESSON_ID);
    expect(lessonItems[1].lesson.id).toBe(LESSON_ID_B);

    const travelItem = res.body.find((item: { type: string }) => item.type === "travel_buffer");
    expect(travelItem).toBeDefined();
    expect(travelItem.fromLocationName).toBe("Egret Park");
    expect(travelItem.toLocationName).toBe("Stonegate");
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
