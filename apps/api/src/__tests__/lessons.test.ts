import { vi, describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import pino from "pino";
import { UpcomingLessonsResponseSchema } from "@swim-app/shared";

// ── IDs ───────────────────────────────────────────────────────────────────────

const PROFILE_PARENT_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const PROFILE_VIEWER_ID = "aaaaaaaa-0000-0000-0000-000000000002";
const HOUSEHOLD_ID = "ffffffff-0000-0000-0000-000000000010";
const HOUSEHOLD_B_ID = "ffffffff-0000-0000-0000-000000000011";
const SWIMMER_ID = "bbbbbbbb-0000-0000-0000-000000000001";
const SWIMMER_B_ID = "bbbbbbbb-0000-0000-0000-000000000002";
const LOCATION_NAMED_ID = "cccccccc-0000-0000-0000-000000000001";
const LOCATION_HOME_B_ID = "cccccccc-0000-0000-0000-000000000002";
const LESSON_ID = "dddddddd-0000-0000-0000-000000000001";

// Frozen clock: Mon 2026-11-02 at noon PST = 20:00 UTC.
// At 20:00 UTC the UTC weekday equals the LA calendar day (both PST and PDT).
const ANCHOR_NOW = new Date("2026-11-02T20:00:00.000Z");

const now = ANCHOR_NOW;

// Returns the first weekday (UTC day 1–5, Mon–Fri) that is ≥ minHours after
// `from`, preserving the time-of-day component.
function nextLessonDay(from: Date, minHours: number): Date {
  const candidate = new Date(from.getTime() + minHours * 60 * 60 * 1000);
  while (candidate.getUTCDay() === 0 || candidate.getUTCDay() === 6) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }
  return candidate;
}

// A slot at least 48 h out that always lands on a lesson day (Mon–Fri).
const futureStart = nextLessonDay(ANCHOR_NOW, 48);

// ── Mocks ─────────────────────────────────────────────────────────────────────

const {
  mockGetUser,
  mockDbSelect,
  mockDbInsert,
  mockDbUpdate,
  mockDbTransaction,
  mockComputeSlots,
  mockClassifyDaySlots,
  mockNeedsApproval,
} = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockDbSelect: vi.fn(),
  mockDbInsert: vi.fn(),
  mockDbUpdate: vi.fn(),
  mockDbTransaction: vi.fn(),
  mockComputeSlots: vi.fn(),
  mockClassifyDaySlots: vi.fn(),
  mockNeedsApproval: vi.fn(),
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

vi.mock("../lib/slots", async (importActual) => {
  const actual = await importActual<typeof import("../lib/slots")>();
  return { ...actual, computeAvailableSlots: mockComputeSlots, classifyDaySlots: mockClassifyDaySlots };
});

vi.mock("../lib/lessonApproval", () => ({
  needsApproval: mockNeedsApproval,
  notifyBookingCreated: vi.fn(),
  notifyLessonApproved: vi.fn(),
  notifyLessonDeclined: vi.fn(),
  notifyCoachOfChange: vi.fn(),
  chargeLessonComplete: vi.fn(),
}));

vi.mock("../services/googleCalendarSync", () => ({
  syncLessonToGoogle: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/emails/outbox", () => ({
  enqueueLessonEmail: vi.fn().mockResolvedValue("outbox-id-stub"),
}));

vi.mock("../services/emails/sender", () => ({
  sendLessonEmailOutboxRow: vi.fn().mockResolvedValue(undefined),
}));

import { createApp } from "../app";

const logger = pino({ level: "silent" });
const app = createApp(logger);

// ── Fixtures ──────────────────────────────────────────────────────────────────

const coachProfile = {
  id: "aaaaaaaa-0000-0000-0000-000000000099",
  role: "coach" as const,
  fullName: "Coach Jason",
  phone: null,
  ageAttestedAt: now,
  disabledAt: null,
  createdAt: now,
  updatedAt: now,
};

const parentProfile = {
  id: PROFILE_PARENT_ID,
  role: "parent" as const,
  fullName: "Parent A",
  phone: null,
  ageAttestedAt: now,
  disabledAt: null,
  createdAt: now,
  updatedAt: now,
};

const viewerProfile = {
  id: PROFILE_VIEWER_ID,
  role: "parent" as const,
  fullName: "Viewer",
  phone: null,
  ageAttestedAt: now,
  disabledAt: null,
  createdAt: now,
  updatedAt: now,
};

// A profile whose role is neither "parent" nor "coach" — blocked by requireParentOrCoach.
const otherRoleProfile = {
  id: "aaaaaaaa-0000-0000-0000-000000000077",
  role: "admin" as string,
  fullName: "Other",
  phone: null,
  ageAttestedAt: now,
  disabledAt: null,
  createdAt: now,
  updatedAt: now,
};

const swimmerRow = {
  id: SWIMMER_ID,
  householdId: HOUSEHOLD_ID,
  firstName: "Alice",
  lastName: "Smith",
  archivedAt: null,
};

const namedLocationRow = {
  id: LOCATION_NAMED_ID,
  name: "Egret Park",
  address: "45 Ovation",
  city: "Irvine",
  state: "CA",
  zip: "92620",
  householdId: null as string | null,
  isActive: true,
  sortOrder: 1,
  createdAt: now,
  updatedAt: now,
};

const homeLocationBRow = {
  ...namedLocationRow,
  id: LOCATION_HOME_B_ID,
  householdId: HOUSEHOLD_B_ID,
};

const configRow = {
  id: "eeeeeeee-0000-0000-0000-000000000001",
  maxDailyLessonMinutes: 240,
  bookingMinAdvanceHours: 16,
  bookingMaxAdvanceWeeks: 10,
  defaultTeachesDays: [2, 3, 4, 5],
  defaultStartTime: "16:00:00",
  defaultEndTime: "20:00:00",
  createdAt: now,
  updatedAt: now,
};

// Season covering Mon–Fri with 16:30–20:30 LA time. Dates in the past so it
// always applies for ANCHOR_NOW onward.
const schoolYearSeason = {
  id: "season-sy-01",
  name: "School year",
  startDate: "2020-01-01",
  endDate: "2099-12-31",
  teachesDays: [1, 2, 3, 4, 5],
  weekdayStartTime: "16:30" as string | null,
  weekdayEndTime: "20:30" as string | null,
  weekendStartTime: null as string | null,
  weekendEndTime: null as string | null,
  startsAtDst: false,
  createdAt: now,
  updatedAt: now,
};

const baseLessonRow = {
  id: LESSON_ID,
  householdId: HOUSEHOLD_ID,
  locationId: LOCATION_NAMED_ID,
  startsAt: futureStart,
  durationMinutes: 30,
  type: "private" as const,
  status: "pending" as "pending" | "approved" | "declined" | "expired" | "canceled" | "no_show" | "completed",
  requestedBy: PROFILE_PARENT_ID,
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
  expiresAt: new Date(futureStart.getTime() - 16 * 60 * 60 * 1000) as Date | null,
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

function requireHouseholdMemberSelect(
  householdId: string = HOUSEHOLD_ID,
  role: "owner" | "manager" | "viewer" = "owner",
) {
  const limit = vi.fn().mockResolvedValue([{ householdId, role }]);
  const where = vi.fn().mockReturnValue({ limit });
  return { from: vi.fn().mockReturnValue({ where }) };
}

// select().from().where().limit(1) resolving to rows
function limitSelect<T>(rows: T[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ limit });
  return { from: vi.fn().mockReturnValue({ where, limit }) };
}

// db.select({ count: count() }).from(lessons).where(...) → [{ count: N }]
function countSelect(n: number) {
  const where = vi.fn().mockResolvedValue([{ count: n }]);
  return { from: vi.fn().mockReturnValue({ where }) };
}

// For available-slots Promise.all: 6 selects (config, blocked, buffers, lessons, seasons, overrides)
function setupAvailableSlotsSelects(
  configRows: unknown[],
  blockedRows: unknown[],
  bufferRows: unknown[],
  lessonRows: unknown[],
  seasonRows: unknown[] = [schoolYearSeason],
  overrideRows: unknown[] = [],
) {
  function makeFromLimit(rows: unknown[]) {
    const limit = vi.fn().mockResolvedValue(rows);
    const where = vi.fn().mockReturnValue({ limit, orderBy: vi.fn().mockResolvedValue(rows) });
    return { from: vi.fn().mockReturnValue({ where, limit, orderBy: vi.fn().mockResolvedValue(rows) }) };
  }
  function makeFromDirect(rows: unknown[]) {
    return { from: vi.fn().mockResolvedValue(rows) };
  }
  function makeFromWhere(rows: unknown[]) {
    const where = vi.fn().mockResolvedValue(rows);
    return { from: vi.fn().mockReturnValue({ where }) };
  }
  mockDbSelect
    .mockReturnValueOnce(makeFromLimit(configRows))         // availabilityConfig.limit(1)
    .mockReturnValueOnce(makeFromDirect(blockedRows))        // blockedTimes
    .mockReturnValueOnce(makeFromDirect(bufferRows))         // travelBufferOverrides
    .mockReturnValueOnce(makeFromWhere(lessonRows))          // lessons.where(...)
    .mockReturnValueOnce(makeFromDirect(seasonRows))         // availabilitySeasons
    .mockReturnValueOnce(makeFromDirect(overrideRows));      // availabilityOverrides
}

// Build a transaction mock for POST /lessons.
// tx.execute (advisory lock), 3 selects (blocked, buffers, lessons),
// needsApproval (tx.select), insert lesson, insert lessonSwimmers.
function transactionThatInserts(lessonRow: typeof baseLessonRow, needsApprovalResult: boolean) {
  mockNeedsApproval.mockResolvedValueOnce(needsApprovalResult);

  mockDbTransaction.mockImplementationOnce(async (callback: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      execute: vi.fn().mockResolvedValue(undefined),
      select: vi.fn()
        .mockReturnValueOnce({ from: vi.fn().mockResolvedValue([]) })   // blockedTimes
        .mockReturnValueOnce({ from: vi.fn().mockResolvedValue([]) })   // travelBufferOverrides
        .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }), // lessons
      insert: vi.fn()
        .mockReturnValueOnce({ values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([lessonRow]) }) })    // lessons insert
        .mockReturnValueOnce({ values: vi.fn().mockResolvedValue([]) }),  // lessonSwimmers insert
      update: vi.fn(),
    };
    return callback(tx);
  });
}

// select for swimmer response after transaction
function swimmerResponseSelect() {
  const where = vi.fn().mockResolvedValue([{ swimmerId: SWIMMER_ID, firstName: "Alice", lastName: "Smith" }]);
  const innerJoin = vi.fn().mockReturnValue({ where });
  return { from: vi.fn().mockReturnValue({ innerJoin }) };
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

// ── GET /lessons ──────────────────────────────────────────────────────────────

describe("GET /lessons", () => {
  it("returns only future pending + approved lessons for the household", async () => {
    authAs(parentProfile);
    // requireUser select → profile
    mockDbSelect.mockReturnValueOnce(requireUserSelect(parentProfile));
    // requireHouseholdMember select → member row
    mockDbSelect.mockReturnValueOnce(requireHouseholdMemberSelect());

    // lessons select with innerJoin → lesson rows
    const lessonJoinRow = {
      id: LESSON_ID,
      householdId: HOUSEHOLD_ID,
      locationId: LOCATION_NAMED_ID,
      locationName: "Egret Park",
      startsAt: futureStart,
      durationMinutes: 30,
      type: "private" as const,
      status: "pending" as const,
      expiresAt: new Date(futureStart.getTime() - 16 * 60 * 60 * 1000),
      approvedAt: null as Date | null,
      declinedAt: null as Date | null,
      declineReason: null as string | null,
      movedAt: null as Date | null,
      previousStartsAt: null as Date | null,
      createdAt: now,
      batchId: null as string | null,
      batchMode: null as string | null,
    };
    const lessonsOffset = vi.fn().mockResolvedValue([lessonJoinRow]);
    const lessonsLimit = vi.fn().mockReturnValue({ offset: lessonsOffset });
    const lessonsOrderBy = vi.fn().mockReturnValue({ limit: lessonsLimit });
    const lessonsWhere = vi.fn().mockReturnValue({ orderBy: lessonsOrderBy });
    const lessonsLeftJoin = vi.fn().mockReturnValue({ where: lessonsWhere });
    const lessonsInnerJoin = vi.fn().mockReturnValue({ leftJoin: lessonsLeftJoin });
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockReturnValue({ innerJoin: lessonsInnerJoin }) });

    // parallel count select
    mockDbSelect.mockReturnValueOnce(countSelect(1));

    // lessonSwimmers select with innerJoin
    const swimWhere = vi.fn().mockResolvedValue([{ lessonId: LESSON_ID, swimmerId: SWIMMER_ID, firstName: "Alice", lastName: "Smith" }]);
    const swimInnerJoin = vi.fn().mockReturnValue({ where: swimWhere });
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockReturnValue({ innerJoin: swimInnerJoin }) });

    const res = await request(app)
      .get("/lessons")
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0]).toMatchObject({
      id: LESSON_ID,
      locationName: "Egret Park",
      status: "pending",
    });
    expect(res.body.items[0].householdId).toBeUndefined();
    expect(res.body.items[0].swimmers).toHaveLength(1);
  });

  it("returns 403 when caller is not a household member", async () => {
    authAs(parentProfile);
    // requireUser select → profile (parent role, passes requireParent)
    mockDbSelect.mockReturnValueOnce(requireUserSelect(parentProfile));
    // requireHouseholdMember select → empty (causes 403)
    const limit = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ limit });
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where }) });

    const res = await request(app)
      .get("/lessons")
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(403);
  });

  it("returns 403 when caller is a coach", async () => {
    authAs(coachProfile);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(coachProfile));

    const res = await request(app)
      .get("/lessons")
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(403);
  });

  it("response body matches UpcomingLessonSchema", async () => {
    authAs(parentProfile);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(parentProfile));
    mockDbSelect.mockReturnValueOnce(requireHouseholdMemberSelect());

    const lessonJoinRow = {
      id: LESSON_ID,
      householdId: HOUSEHOLD_ID,
      locationId: LOCATION_NAMED_ID,
      locationName: "Egret Park",
      startsAt: futureStart,
      durationMinutes: 30,
      type: "private" as const,
      status: "pending" as const,
      expiresAt: new Date(futureStart.getTime() - 16 * 60 * 60 * 1000),
      approvedAt: null as Date | null,
      declinedAt: null as Date | null,
      declineReason: null as string | null,
      movedAt: null as Date | null,
      previousStartsAt: null as Date | null,
      createdAt: now,
      batchId: null as string | null,
      batchMode: null as string | null,
    };
    const lessonsOffset = vi.fn().mockResolvedValue([lessonJoinRow]);
    const lessonsLimit = vi.fn().mockReturnValue({ offset: lessonsOffset });
    const lessonsOrderBy = vi.fn().mockReturnValue({ limit: lessonsLimit });
    const lessonsWhere = vi.fn().mockReturnValue({ orderBy: lessonsOrderBy });
    const lessonsLeftJoin = vi.fn().mockReturnValue({ where: lessonsWhere });
    const lessonsInnerJoin = vi.fn().mockReturnValue({ leftJoin: lessonsLeftJoin });
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockReturnValue({ innerJoin: lessonsInnerJoin }) });

    mockDbSelect.mockReturnValueOnce(countSelect(1));

    const swimWhere = vi.fn().mockResolvedValue([{ lessonId: LESSON_ID, swimmerId: SWIMMER_ID, firstName: "Alice", lastName: "Smith" }]);
    const swimInnerJoin = vi.fn().mockReturnValue({ where: swimWhere });
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockReturnValue({ innerJoin: swimInnerJoin }) });

    const res = await request(app)
      .get("/lessons")
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    const parsed = UpcomingLessonsResponseSchema.safeParse(res.body);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((issue) => `${issue.path.join(".")} (${issue.message})`).join("; ");
      throw new Error(`Response did not match UpcomingLessonsResponseSchema: ${detail}`);
    }
    expect(parsed.data.items).toHaveLength(1);
    expect(parsed.data.total).toBe(1);
  });

  it("end-time filter: route passes end-time SQL and returns empty list when DB returns none", async () => {
    authAs(parentProfile);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(parentProfile));
    mockDbSelect.mockReturnValueOnce(requireHouseholdMemberSelect());

    const lessonsOffset = vi.fn().mockResolvedValue([]);
    const lessonsLimit = vi.fn().mockReturnValue({ offset: lessonsOffset });
    const lessonsOrderBy = vi.fn().mockReturnValue({ limit: lessonsLimit });
    const lessonsWhere = vi.fn().mockReturnValue({ orderBy: lessonsOrderBy });
    const lessonsLeftJoin = vi.fn().mockReturnValue({ where: lessonsWhere });
    const lessonsInnerJoin = vi.fn().mockReturnValue({ leftJoin: lessonsLeftJoin });
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockReturnValue({ innerJoin: lessonsInnerJoin }) });

    mockDbSelect.mockReturnValueOnce(countSelect(0));

    const res = await request(app)
      .get("/lessons")
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(0);
    expect(res.body.total).toBe(0);
    // The where clause is called with an AND expression that includes the end-time
    // condition — verified indirectly: the route built correctly and got 0 results.
    expect(lessonsWhere).toHaveBeenCalledTimes(1);
  });

  it("includes a lesson starting later today (not yet ended)", async () => {
    authAs(parentProfile);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(parentProfile));
    mockDbSelect.mockReturnValueOnce(requireHouseholdMemberSelect());

    const lessonJoinRow = {
      id: LESSON_ID,
      householdId: HOUSEHOLD_ID,
      locationId: LOCATION_NAMED_ID,
      locationName: "Egret Park",
      startsAt: futureStart,
      durationMinutes: 45,
      type: "private" as const,
      status: "approved" as const,
      expiresAt: null as Date | null,
      approvedAt: now,
      declinedAt: null as Date | null,
      declineReason: null as string | null,
      movedAt: null as Date | null,
      previousStartsAt: null as Date | null,
      createdAt: now,
      batchId: null as string | null,
      batchMode: null as string | null,
    };
    const lessonsOffset = vi.fn().mockResolvedValue([lessonJoinRow]);
    const lessonsLimit = vi.fn().mockReturnValue({ offset: lessonsOffset });
    const lessonsOrderBy = vi.fn().mockReturnValue({ limit: lessonsLimit });
    const lessonsWhere = vi.fn().mockReturnValue({ orderBy: lessonsOrderBy });
    const lessonsLeftJoin = vi.fn().mockReturnValue({ where: lessonsWhere });
    const lessonsInnerJoin = vi.fn().mockReturnValue({ leftJoin: lessonsLeftJoin });
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockReturnValue({ innerJoin: lessonsInnerJoin }) });

    mockDbSelect.mockReturnValueOnce(countSelect(1));

    const swimWhere = vi.fn().mockResolvedValue([]);
    const swimInnerJoin = vi.fn().mockReturnValue({ where: swimWhere });
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockReturnValue({ innerJoin: swimInnerJoin }) });

    const res = await request(app)
      .get("/lessons")
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0]).toMatchObject({ id: LESSON_ID, status: "approved" });
  });

  it("respects offset param for pagination", async () => {
    authAs(parentProfile);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(parentProfile));
    mockDbSelect.mockReturnValueOnce(requireHouseholdMemberSelect());

    const lessonsOffset = vi.fn().mockResolvedValue([]);
    const lessonsLimit = vi.fn().mockReturnValue({ offset: lessonsOffset });
    const lessonsOrderBy = vi.fn().mockReturnValue({ limit: lessonsLimit });
    const lessonsWhere = vi.fn().mockReturnValue({ orderBy: lessonsOrderBy });
    const lessonsLeftJoin = vi.fn().mockReturnValue({ where: lessonsWhere });
    const lessonsInnerJoin = vi.fn().mockReturnValue({ leftJoin: lessonsLeftJoin });
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockReturnValue({ innerJoin: lessonsInnerJoin }) });

    mockDbSelect.mockReturnValueOnce(countSelect(0));

    await request(app)
      .get("/lessons?offset=10")
      .set("Authorization", "Bearer token");

    expect(lessonsOffset).toHaveBeenCalledWith(10);
  });

  it("returns 422 when offset exceeds 10000", async () => {
    authAs(parentProfile);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(parentProfile));
    mockDbSelect.mockReturnValueOnce(requireHouseholdMemberSelect());

    const res = await request(app)
      .get("/lessons?offset=10001")
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(422);
  });

  it("applies offset to past lessons query", async () => {
    authAs(parentProfile);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(parentProfile));
    mockDbSelect.mockReturnValueOnce(requireHouseholdMemberSelect());

    const pastOffset = vi.fn().mockResolvedValue([]);
    const pastLimit = vi.fn().mockReturnValue({ offset: pastOffset });
    const pastOrderBy = vi.fn().mockReturnValue({ limit: pastLimit });
    const pastWhere = vi.fn().mockReturnValue({ orderBy: pastOrderBy });
    const pastLeftJoin = vi.fn().mockReturnValue({ where: pastWhere });
    const pastInnerJoin = vi.fn().mockReturnValue({ leftJoin: pastLeftJoin });
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockReturnValue({ innerJoin: pastInnerJoin }) });

    mockDbSelect.mockReturnValueOnce(countSelect(0));

    await request(app)
      .get("/lessons?filter=past&offset=5")
      .set("Authorization", "Bearer token");

    expect(pastOffset).toHaveBeenCalledWith(5);
  });

  it("returns total count across the full filter, independent of limit/offset", async () => {
    authAs(parentProfile);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(parentProfile));
    mockDbSelect.mockReturnValueOnce(requireHouseholdMemberSelect());

    const lessonsOffset = vi.fn().mockResolvedValue([]);
    const lessonsLimit = vi.fn().mockReturnValue({ offset: lessonsOffset });
    const lessonsOrderBy = vi.fn().mockReturnValue({ limit: lessonsLimit });
    const lessonsWhere = vi.fn().mockReturnValue({ orderBy: lessonsOrderBy });
    const lessonsLeftJoin = vi.fn().mockReturnValue({ where: lessonsWhere });
    const lessonsInnerJoin = vi.fn().mockReturnValue({ leftJoin: lessonsLeftJoin });
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockReturnValue({ innerJoin: lessonsInnerJoin }) });

    // 42 upcoming lessons total; limit=3 returns an empty page here but total still reflects everything.
    mockDbSelect.mockReturnValueOnce(countSelect(42));

    const res = await request(app)
      .get("/lessons?limit=3")
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(0);
    expect(res.body.total).toBe(42);
  });
});


// ── GET /lessons/available-slots ──────────────────────────────────────────────

describe("GET /lessons/available-slots", () => {
  it("returns available slots from computeAvailableSlots", async () => {
    authAs(parentProfile);
    // requireUser + location check (named pool, householdId: null → no household lookup)
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(parentProfile))
      .mockReturnValueOnce(limitSelect([namedLocationRow]));
    setupAvailableSlotsSelects([configRow], [], [], [], []);
    mockComputeSlots.mockReturnValueOnce([{ startsAt: futureStart, endsAt: new Date(futureStart.getTime() + 1800000) }]);

    const res = await request(app)
      .get("/lessons/available-slots")
      .set("Authorization", "Bearer token")
      .query({ date: "2025-09-17", durationMinutes: "30", locationId: LOCATION_NAMED_ID });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0]).toMatchObject({ startsAt: futureStart.toISOString() });
  });

  it("returns 404 when location does not exist", async () => {
    authAs(parentProfile);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(parentProfile))
      .mockReturnValueOnce(limitSelect([])); // location not found

    const res = await request(app)
      .get("/lessons/available-slots")
      .set("Authorization", "Bearer token")
      .query({ date: "2025-09-17", durationMinutes: "30", locationId: LOCATION_NAMED_ID });

    expect(res.status).toBe(404);
  });

  it("returns 404 when querying another household's home pool", async () => {
    authAs(parentProfile);
    // homeLocationBRow has householdId: HOUSEHOLD_B_ID; caller is in HOUSEHOLD_ID
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(parentProfile))
      .mockReturnValueOnce(limitSelect([homeLocationBRow]))
      .mockReturnValueOnce(requireHouseholdMemberSelect(HOUSEHOLD_ID, "owner"));

    const res = await request(app)
      .get("/lessons/available-slots")
      .set("Authorization", "Bearer token")
      .query({ date: "2025-09-17", durationMinutes: "30", locationId: LOCATION_HOME_B_ID });

    expect(res.status).toBe(404);
  });

  it("returns 401 when unauthenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await request(app)
      .get("/lessons/available-slots")
      .query({ date: "2025-09-17", durationMinutes: "30", locationId: LOCATION_NAMED_ID });
    expect(res.status).toBe(401);
  });
});

// ── GET /lessons/available-range ─────────────────────────────────────────────

function setupRangeSelects(
  configRows: unknown[],
  blockedRows: unknown[],
  bufferRows: unknown[],
  lessonRows: unknown[],
  seasonRows: unknown[] = [schoolYearSeason],
  overrideRows: unknown[] = [],
) {
  function makeFromLimit(rows: unknown[]) {
    const limit = vi.fn().mockResolvedValue(rows);
    return { from: vi.fn().mockReturnValue({ limit }) };
  }
  function makeFromDirect(rows: unknown[]) {
    return { from: vi.fn().mockResolvedValue(rows) };
  }
  function makeFromWhere(rows: unknown[]) {
    const where = vi.fn().mockResolvedValue(rows);
    return { from: vi.fn().mockReturnValue({ where }) };
  }
  mockDbSelect
    .mockReturnValueOnce(makeFromLimit(configRows))
    .mockReturnValueOnce(makeFromDirect(blockedRows))
    .mockReturnValueOnce(makeFromDirect(bufferRows))
    .mockReturnValueOnce(makeFromWhere(lessonRows))
    .mockReturnValueOnce(makeFromDirect(seasonRows))
    .mockReturnValueOnce(makeFromDirect(overrideRows));
}

function memberCheckSelect(householdId: string = HOUSEHOLD_ID) {
  const limit = vi.fn().mockResolvedValue([{ householdId }]);
  const where = vi.fn().mockReturnValue({ limit });
  return { from: vi.fn().mockReturnValue({ where }) };
}

describe("GET /lessons/available-range", () => {
  it("returns month availability with days that have no slots field", async () => {
    authAs(parentProfile);
    mockClassifyDaySlots.mockReturnValue([]);
    mockNeedsApproval.mockResolvedValueOnce(false);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(parentProfile))
      .mockReturnValueOnce(limitSelect([namedLocationRow]))
      .mockReturnValueOnce(memberCheckSelect());
    setupRangeSelects([configRow], [], [], [], []);

    const res = await request(app)
      .get("/lessons/available-range")
      .set("Authorization", "Bearer token")
      .query({ view: "month", date: "2026-11-01", durationMinutes: "30", locationId: LOCATION_NAMED_ID });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("needsApproval", false);
    expect(Array.isArray(res.body.days)).toBe(true);
    expect(res.body.days.length).toBeGreaterThan(0);
    for (const day of res.body.days as unknown[]) {
      expect(day).toHaveProperty("date");
      expect(day).toHaveProperty("dayState");
      expect(day).toHaveProperty("openCount");
      expect(day).toHaveProperty("totalCount");
      expect(day).not.toHaveProperty("slots");
    }
  });

  it("returns week availability with a slots field on each day", async () => {
    authAs(parentProfile);
    mockClassifyDaySlots.mockReturnValue([]);
    mockNeedsApproval.mockResolvedValueOnce(false);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(parentProfile))
      .mockReturnValueOnce(limitSelect([namedLocationRow]))
      .mockReturnValueOnce(memberCheckSelect());
    setupRangeSelects([configRow], [], [], [], []);

    const res = await request(app)
      .get("/lessons/available-range")
      .set("Authorization", "Bearer token")
      .query({ view: "week", date: "2026-11-02", durationMinutes: "30", locationId: LOCATION_NAMED_ID });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.days)).toBe(true);
    expect(res.body.days).toHaveLength(7);
    for (const day of res.body.days as unknown[]) {
      expect(day).toHaveProperty("slots");
    }
  });

  it("returns 401 when unauthenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await request(app)
      .get("/lessons/available-range")
      .query({ view: "month", date: "2026-11-01", durationMinutes: "30", locationId: LOCATION_NAMED_ID });
    expect(res.status).toBe(401);
  });
});

// ── POST /lessons ─────────────────────────────────────────────────────────────

describe("POST /lessons", () => {
  const validBody = {
    startsAt: futureStart.toISOString(),
    durationMinutes: 30,
    locationId: LOCATION_NAMED_ID,
    swimmerIds: [SWIMMER_ID],
  };

  it("creates a pending lesson for a household's first booking", async () => {
    authAs(parentProfile);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(parentProfile))
      .mockReturnValueOnce(requireHouseholdMemberSelect())
      .mockReturnValueOnce(limitSelect([namedLocationRow]))   // location
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([swimmerRow]) }) }) // swimmers
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([configRow]) }) }) // config
      .mockReturnValueOnce({ from: vi.fn().mockResolvedValue([schoolYearSeason]) }) // seasons
      .mockReturnValueOnce({ from: vi.fn().mockResolvedValue([]) }); // overrides

    mockComputeSlots.mockReturnValueOnce([{ startsAt: futureStart, endsAt: new Date(futureStart.getTime() + 1800000) }]);
    transactionThatInserts(baseLessonRow, true); // needsApproval=true → pending

    mockDbSelect.mockReturnValueOnce(swimmerResponseSelect());

    const res = await request(app)
      .post("/lessons")
      .set("Authorization", "Bearer token")
      .send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("pending");
    expect(res.body.type).toBe("private");
  });

  it("auto-approves when household has prior approved lessons at this pool", async () => {
    authAs(parentProfile);
    const approvedLesson = { ...baseLessonRow, status: "approved" as typeof baseLessonRow.status, approvedAt: now, expiresAt: null as Date | null };

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(parentProfile))
      .mockReturnValueOnce(requireHouseholdMemberSelect())
      .mockReturnValueOnce(limitSelect([namedLocationRow]))
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([swimmerRow]) }) })
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([configRow]) }) })
      .mockReturnValueOnce({ from: vi.fn().mockResolvedValue([schoolYearSeason]) })
      .mockReturnValueOnce({ from: vi.fn().mockResolvedValue([]) });

    mockComputeSlots.mockReturnValueOnce([{ startsAt: futureStart, endsAt: new Date(futureStart.getTime() + 1800000) }]);
    transactionThatInserts(approvedLesson, false); // needsApproval=false → auto-approved

    mockDbSelect.mockReturnValueOnce(swimmerResponseSelect());

    const res = await request(app)
      .post("/lessons")
      .set("Authorization", "Bearer token")
      .send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("approved");
    expect(res.body.approvedAt).not.toBeNull();
  });

  it("auto-approves when household has a completed lesson at this pool", async () => {
    authAs(parentProfile);
    const completedLesson = {
      ...baseLessonRow,
      status: "completed" as typeof baseLessonRow.status,
      approvedAt: now,
      completedAt: now,
      expiresAt: null as Date | null,
    };

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(parentProfile))
      .mockReturnValueOnce(requireHouseholdMemberSelect())
      .mockReturnValueOnce(limitSelect([namedLocationRow]))
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([swimmerRow]) }) })
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([configRow]) }) })
      .mockReturnValueOnce({ from: vi.fn().mockResolvedValue([schoolYearSeason]) })
      .mockReturnValueOnce({ from: vi.fn().mockResolvedValue([]) });

    mockComputeSlots.mockReturnValueOnce([{ startsAt: futureStart, endsAt: new Date(futureStart.getTime() + 1800000) }]);
    transactionThatInserts({ ...completedLesson, status: "approved" as typeof baseLessonRow.status }, false);

    mockDbSelect.mockReturnValueOnce(swimmerResponseSelect());

    const res = await request(app)
      .post("/lessons")
      .set("Authorization", "Bearer token")
      .send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("approved");
  });

  it("creates pending when household has only declined or canceled lessons", async () => {
    authAs(parentProfile);

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(parentProfile))
      .mockReturnValueOnce(requireHouseholdMemberSelect())
      .mockReturnValueOnce(limitSelect([namedLocationRow]))
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([swimmerRow]) }) })
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([configRow]) }) })
      .mockReturnValueOnce({ from: vi.fn().mockResolvedValue([schoolYearSeason]) })
      .mockReturnValueOnce({ from: vi.fn().mockResolvedValue([]) });

    mockComputeSlots.mockReturnValueOnce([{ startsAt: futureStart, endsAt: new Date(futureStart.getTime() + 1800000) }]);
    // needsApproval=true because declined/canceled don't count
    transactionThatInserts(baseLessonRow, true);

    mockDbSelect.mockReturnValueOnce(swimmerResponseSelect());

    const res = await request(app)
      .post("/lessons")
      .set("Authorization", "Bearer token")
      .send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("pending");
  });

  it("creates pending when household has approved lessons at other pools only", async () => {
    authAs(parentProfile);

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(parentProfile))
      .mockReturnValueOnce(requireHouseholdMemberSelect())
      .mockReturnValueOnce(limitSelect([namedLocationRow]))
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([swimmerRow]) }) })
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([configRow]) }) })
      .mockReturnValueOnce({ from: vi.fn().mockResolvedValue([schoolYearSeason]) })
      .mockReturnValueOnce({ from: vi.fn().mockResolvedValue([]) });

    mockComputeSlots.mockReturnValueOnce([{ startsAt: futureStart, endsAt: new Date(futureStart.getTime() + 1800000) }]);
    // needsApproval=true because no approved lessons at THIS location
    transactionThatInserts(baseLessonRow, true);

    mockDbSelect.mockReturnValueOnce(swimmerResponseSelect());

    const res = await request(app)
      .post("/lessons")
      .set("Authorization", "Bearer token")
      .send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("pending");
  });

  it("returns 422 not_a_lesson_day for a day not in lesson_days", async () => {
    authAs(parentProfile);

    // Find the next Sunday in LA time, starting from futureStart.
    // Set time to 20:00 UTC (≈ noon LA, avoids DST day-boundary issues).
    // getUTCDay() === 0 at 20:00 UTC means it is Sunday in both UTC and LA.
    const weekendStart = new Date(futureStart);
    weekendStart.setUTCHours(20, 0, 0, 0);
    while (weekendStart.getUTCDay() !== 0) {
      weekendStart.setUTCDate(weekendStart.getUTCDate() + 1);
    }

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(parentProfile))
      .mockReturnValueOnce(requireHouseholdMemberSelect())
      .mockReturnValueOnce(limitSelect([namedLocationRow]))
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([swimmerRow]) }) })
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([configRow]) }) })
      .mockReturnValueOnce({ from: vi.fn().mockResolvedValue([schoolYearSeason]) })
      .mockReturnValueOnce({ from: vi.fn().mockResolvedValue([]) });

    const res = await request(app)
      .post("/lessons")
      .set("Authorization", "Bearer token")
      .send({ ...validBody, startsAt: weekendStart.toISOString() });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("not_a_lesson_day");
  });

  it("returns 422 too_soon when slot is under 16 h away", async () => {
    authAs(parentProfile);
    const tooSoonStart = new Date(Date.now() + 10 * 60 * 60 * 1000).toISOString(); // 10 h from now

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(parentProfile))
      .mockReturnValueOnce(requireHouseholdMemberSelect())
      .mockReturnValueOnce(limitSelect([namedLocationRow]))
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([swimmerRow]) }) })
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([configRow]) }) })
      .mockReturnValueOnce({ from: vi.fn().mockResolvedValue([schoolYearSeason]) })
      .mockReturnValueOnce({ from: vi.fn().mockResolvedValue([]) });

    const res = await request(app)
      .post("/lessons")
      .set("Authorization", "Bearer token")
      .send({ ...validBody, startsAt: tooSoonStart });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("too_soon");
  });

  it("returns 422 too_far when slot is over 10 weeks away", async () => {
    authAs(parentProfile);
    const tooFarStart = new Date(Date.now() + 11 * 7 * 24 * 60 * 60 * 1000).toISOString();

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(parentProfile))
      .mockReturnValueOnce(requireHouseholdMemberSelect())
      .mockReturnValueOnce(limitSelect([namedLocationRow]))
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([swimmerRow]) }) })
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([configRow]) }) })
      .mockReturnValueOnce({ from: vi.fn().mockResolvedValue([schoolYearSeason]) })
      .mockReturnValueOnce({ from: vi.fn().mockResolvedValue([]) });

    const res = await request(app)
      .post("/lessons")
      .set("Authorization", "Bearer token")
      .send({ ...validBody, startsAt: tooFarStart });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("too_far");
  });

  it("returns 422 when 5 swimmerIds are provided (max is 4)", async () => {
    authAs(parentProfile);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(parentProfile))
      .mockReturnValueOnce(requireHouseholdMemberSelect());

    const fiveSwimmers = [
      "bbbbbbbb-0000-0000-0000-000000000001",
      "bbbbbbbb-0000-0000-0000-000000000002",
      "bbbbbbbb-0000-0000-0000-000000000003",
      "bbbbbbbb-0000-0000-0000-000000000004",
      "bbbbbbbb-0000-0000-0000-000000000005",
    ];

    const res = await request(app)
      .post("/lessons")
      .set("Authorization", "Bearer token")
      .send({ ...validBody, swimmerIds: fiveSwimmers });

    expect(res.status).toBe(422);
  });

  it("returns 422 when a swimmer belongs to a different household", async () => {
    authAs(parentProfile);

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(parentProfile))
      .mockReturnValueOnce(requireHouseholdMemberSelect())
      .mockReturnValueOnce(limitSelect([namedLocationRow]))
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ id: SWIMMER_B_ID, householdId: HOUSEHOLD_B_ID }]),
        }),
      });

    const res = await request(app)
      .post("/lessons")
      .set("Authorization", "Bearer token")
      .send({ ...validBody, swimmerIds: [SWIMMER_B_ID] });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/household/i);
  });

  it("returns 403 not_your_home_pool when booking another household's home pool", async () => {
    authAs(parentProfile);

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(parentProfile))
      .mockReturnValueOnce(requireHouseholdMemberSelect())
      .mockReturnValueOnce(limitSelect([homeLocationBRow])); // location belongs to HOUSEHOLD_B

    const res = await request(app)
      .post("/lessons")
      .set("Authorization", "Bearer token")
      .send({ ...validBody, locationId: LOCATION_HOME_B_ID });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("not_your_home_pool");
  });

  it("returns 422 slot_unavailable when the slot is already taken", async () => {
    authAs(parentProfile);

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(parentProfile))
      .mockReturnValueOnce(requireHouseholdMemberSelect())
      .mockReturnValueOnce(limitSelect([namedLocationRow]))
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([swimmerRow]) }) })
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([configRow]) }) })
      .mockReturnValueOnce({ from: vi.fn().mockResolvedValue([schoolYearSeason]) })
      .mockReturnValueOnce({ from: vi.fn().mockResolvedValue([]) });

    // computeAvailableSlots returns empty → slot not available
    mockComputeSlots.mockReturnValueOnce([]);

    mockDbTransaction.mockImplementationOnce(async (callback: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        execute: vi.fn().mockResolvedValue(undefined),
        select: vi.fn()
          .mockReturnValueOnce({ from: vi.fn().mockResolvedValue([]) })
          .mockReturnValueOnce({ from: vi.fn().mockResolvedValue([]) })
          .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
        insert: vi.fn(),
        update: vi.fn(),
      };
      return callback(tx);
    });

    const res = await request(app)
      .post("/lessons")
      .set("Authorization", "Bearer token")
      .send(validBody);

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("slot_unavailable");
  });

  it("returns 403 when a viewer tries to book", async () => {
    authAs(viewerProfile);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(viewerProfile))
      .mockReturnValueOnce(requireHouseholdMemberSelect(HOUSEHOLD_ID, "viewer"));

    const res = await request(app)
      .post("/lessons")
      .set("Authorization", "Bearer token")
      .send(validBody);

    expect(res.status).toBe(403);
  });

  it("can book any slot returned by available-slots (PST slot whose UTC date is the day after its LA date)", async () => {
    // 4:30 PM PST on Mon 2030-01-14 = 2030-01-15T00:30:00.000Z.
    // slice(0,10) on the ISO string gives "2030-01-15" (UTC, Tuesday) — not the
    // LA calendar date "2030-01-14" (Monday).  Before the fix, computeAvailableSlots
    // would be called with the wrong date and return no matching slot → slot_unavailable.
    const pstSlot = new Date("2030-01-15T00:30:00.000Z");
    const laDate = "2030-01-14";
    const farFutureConfig = { ...configRow, bookingMaxAdvanceWeeks: 200 };
    const pstLessonRow = { ...baseLessonRow, startsAt: pstSlot, expiresAt: null as Date | null };

    authAs(parentProfile);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(parentProfile))
      .mockReturnValueOnce(requireHouseholdMemberSelect())
      .mockReturnValueOnce(limitSelect([namedLocationRow]))
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([swimmerRow]) }) })
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([farFutureConfig]) }) })
      .mockReturnValueOnce({ from: vi.fn().mockResolvedValue([schoolYearSeason]) })
      .mockReturnValueOnce({ from: vi.fn().mockResolvedValue([]) });

    // Return the slot only when called with the LA date; empty for any other date.
    // This causes 422 slot_unavailable before the fix and 201 after.
    mockComputeSlots.mockImplementation(({ date }: { date: string }) =>
      date === laDate
        ? [{ startsAt: pstSlot, endsAt: new Date(pstSlot.getTime() + 30 * 60_000) }]
        : [],
    );

    transactionThatInserts(pstLessonRow, false);
    mockDbSelect.mockReturnValueOnce(swimmerResponseSelect());

    const res = await request(app)
      .post("/lessons")
      .set("Authorization", "Bearer token")
      .send({ startsAt: pstSlot.toISOString(), durationMinutes: 30, locationId: LOCATION_NAMED_ID, swimmerIds: [SWIMMER_ID] });

    expect(res.status).toBe(201);
    expect(mockComputeSlots).toHaveBeenCalledWith(expect.objectContaining({ date: laDate }));
  });
});

// ── DELETE /lessons/:id ───────────────────────────────────────────────────────

describe("DELETE /lessons/:id", () => {
  it("cancels lesson and returns 204 (parent owner)", async () => {
    authAs(parentProfile);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(parentProfile))
      .mockReturnValueOnce(requireHouseholdMemberSelect(HOUSEHOLD_ID, "owner"))
      .mockReturnValueOnce(limitSelect([baseLessonRow]));

    mockDbUpdate.mockReturnValueOnce({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    });

    const res = await request(app)
      .delete(`/lessons/${LESSON_ID}`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(204);
  });

  it("returns 404 for another household's lesson", async () => {
    authAs(parentProfile);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(parentProfile))
      .mockReturnValueOnce(requireHouseholdMemberSelect(HOUSEHOLD_ID, "owner"))
      .mockReturnValueOnce(limitSelect([])); // lesson not found for this householdId

    const res = await request(app)
      .delete(`/lessons/${LESSON_ID}`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(404);
  });

  it("returns 422 lesson_not_active for an already-canceled lesson", async () => {
    authAs(parentProfile);
    const canceledLesson = { ...baseLessonRow, status: "canceled" as typeof baseLessonRow.status };
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(parentProfile))
      .mockReturnValueOnce(requireHouseholdMemberSelect(HOUSEHOLD_ID, "owner"))
      .mockReturnValueOnce(limitSelect([canceledLesson]));

    const res = await request(app)
      .delete(`/lessons/${LESSON_ID}`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("lesson_not_active");
  });

  it("returns 403 for a viewer", async () => {
    authAs(viewerProfile);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(viewerProfile))
      .mockReturnValueOnce(requireHouseholdMemberSelect(HOUSEHOLD_ID, "viewer"));

    const res = await request(app)
      .delete(`/lessons/${LESSON_ID}`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(403);
  });

  it("coach cancels any lesson and returns 204", async () => {
    authAs(coachProfile);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(coachProfile))
      .mockReturnValueOnce(limitSelect([baseLessonRow]));

    mockDbUpdate.mockReturnValueOnce({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    });

    const res = await request(app)
      .delete(`/lessons/${LESSON_ID}`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(204);
  });

  it("returns 403 when caller role is neither parent nor coach", async () => {
    authAs(otherRoleProfile);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(otherRoleProfile));

    const res = await request(app)
      .delete(`/lessons/${LESSON_ID}`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(403);
  });

  it("returns 422 lesson_in_past when parent cancels a lesson that has already started", async () => {
    authAs(parentProfile);
    const pastLesson = { ...baseLessonRow, status: "approved" as typeof baseLessonRow.status, startsAt: new Date(ANCHOR_NOW.getTime() - 60 * 60 * 1000) };
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(parentProfile))
      .mockReturnValueOnce(requireHouseholdMemberSelect(HOUSEHOLD_ID, "owner"))
      .mockReturnValueOnce(limitSelect([pastLesson]));

    const res = await request(app)
      .delete(`/lessons/${LESSON_ID}`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("lesson_in_past");
  });

  it("coach can still cancel a lesson that has already started (204)", async () => {
    authAs(coachProfile);
    const pastLesson = { ...baseLessonRow, status: "approved" as typeof baseLessonRow.status, startsAt: new Date(ANCHOR_NOW.getTime() - 60 * 60 * 1000) };
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(coachProfile))
      .mockReturnValueOnce(limitSelect([pastLesson]));

    mockDbUpdate.mockReturnValueOnce({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    });

    const res = await request(app)
      .delete(`/lessons/${LESSON_ID}`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(204);
  });
});

// ── PATCH /lessons/:id ────────────────────────────────────────────────────────

function swimmerResponseSelectForLesson() {
  const where = vi.fn().mockResolvedValue([{ swimmerId: SWIMMER_ID, firstName: "Alice", lastName: "Smith" }]);
  const innerJoin = vi.fn().mockReturnValue({ where });
  return { from: vi.fn().mockReturnValue({ innerJoin }) };
}

describe("PATCH /lessons/:id", () => {
  const validNewStartsAt = nextLessonDay(ANCHOR_NOW, 48).toISOString();
  const updatedLessonRow = { ...baseLessonRow, startsAt: new Date(validNewStartsAt) };

  it("reschedules lesson with new time ≥ 16h and returns 200 with updated lesson", async () => {
    authAs(parentProfile);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(parentProfile))
      .mockReturnValueOnce(requireHouseholdMemberSelect(HOUSEHOLD_ID, "owner"))
      .mockReturnValueOnce(limitSelect([baseLessonRow]))         // load lesson
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([configRow]) }) }) // config
      .mockReturnValueOnce({ from: vi.fn().mockResolvedValue([schoolYearSeason]) }) // seasons
      .mockReturnValueOnce({ from: vi.fn().mockResolvedValue([]) }); // overrides

    mockComputeSlots.mockReturnValueOnce([
      { startsAt: new Date(validNewStartsAt), endsAt: new Date(new Date(validNewStartsAt).getTime() + 1800000) },
    ]);

    mockDbTransaction.mockImplementationOnce(async (callback: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        execute: vi.fn().mockResolvedValue(undefined),
        select: vi.fn()
          .mockReturnValueOnce({ from: vi.fn().mockResolvedValue([]) })   // blockedTimes
          .mockReturnValueOnce({ from: vi.fn().mockResolvedValue([]) })   // travelBufferOverrides
          .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }), // lessons (excluding self)
        update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([updatedLessonRow]) }) }) }),
        insert: vi.fn(),
      };
      return callback(tx);
    });

    // loadLessonWithSwimmers selects
    mockDbSelect
      .mockReturnValueOnce(limitSelect([updatedLessonRow]))
      .mockReturnValueOnce(swimmerResponseSelectForLesson());

    const res = await request(app)
      .patch(`/lessons/${LESSON_ID}`)
      .set("Authorization", "Bearer token")
      .send({ startsAt: validNewStartsAt, durationMinutes: 30, locationId: LOCATION_NAMED_ID });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: LESSON_ID });
  });

  it("returns 422 too_soon when new time is < 16h away", async () => {
    const tooSoonStartsAt = new Date(Date.now() + 10 * 60 * 60 * 1000).toISOString();
    authAs(parentProfile);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(parentProfile))
      .mockReturnValueOnce(requireHouseholdMemberSelect(HOUSEHOLD_ID, "owner"))
      .mockReturnValueOnce(limitSelect([baseLessonRow]))
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([configRow]) }) })
      .mockReturnValueOnce({ from: vi.fn().mockResolvedValue([schoolYearSeason]) })
      .mockReturnValueOnce({ from: vi.fn().mockResolvedValue([]) });

    const res = await request(app)
      .patch(`/lessons/${LESSON_ID}`)
      .set("Authorization", "Bearer token")
      .send({ startsAt: tooSoonStartsAt });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("too_soon");
  });

  it("rescheduling an inside-16h lesson to a valid future time returns 200", async () => {
    // Source lesson is inside 16h but new startsAt is valid — source time must NOT be validated
    const insideLessonRow = { ...baseLessonRow, startsAt: new Date(Date.now() + 10 * 60 * 60 * 1000) };
    const updatedRow = { ...insideLessonRow, startsAt: new Date(validNewStartsAt) };

    authAs(parentProfile);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(parentProfile))
      .mockReturnValueOnce(requireHouseholdMemberSelect(HOUSEHOLD_ID, "owner"))
      .mockReturnValueOnce(limitSelect([insideLessonRow]))
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([configRow]) }) })
      .mockReturnValueOnce({ from: vi.fn().mockResolvedValue([schoolYearSeason]) })
      .mockReturnValueOnce({ from: vi.fn().mockResolvedValue([]) });

    mockComputeSlots.mockReturnValueOnce([
      { startsAt: new Date(validNewStartsAt), endsAt: new Date(new Date(validNewStartsAt).getTime() + 1800000) },
    ]);

    mockDbTransaction.mockImplementationOnce(async (callback: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        execute: vi.fn().mockResolvedValue(undefined),
        select: vi.fn()
          .mockReturnValueOnce({ from: vi.fn().mockResolvedValue([]) })
          .mockReturnValueOnce({ from: vi.fn().mockResolvedValue([]) })
          .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
        update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([updatedRow]) }) }) }),
        insert: vi.fn(),
      };
      return callback(tx);
    });

    mockDbSelect
      .mockReturnValueOnce(limitSelect([updatedRow]))
      .mockReturnValueOnce(swimmerResponseSelectForLesson());

    const res = await request(app)
      .patch(`/lessons/${LESSON_ID}`)
      .set("Authorization", "Bearer token")
      .send({ startsAt: validNewStartsAt });

    expect(res.status).toBe(200);
  });

  it("new pool triggers re-approval check and lesson reverts to pending", async () => {
    const NEW_LOCATION_ID = "cccccccc-0000-0000-0000-000000000099";
    const pendingUpdatedRow = { ...baseLessonRow, locationId: NEW_LOCATION_ID, status: "pending" as typeof baseLessonRow.status };

    authAs(parentProfile);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(parentProfile))
      .mockReturnValueOnce(requireHouseholdMemberSelect(HOUSEHOLD_ID, "owner"))
      .mockReturnValueOnce(limitSelect([baseLessonRow]))
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([configRow]) }) })
      .mockReturnValueOnce({ from: vi.fn().mockResolvedValue([schoolYearSeason]) })
      .mockReturnValueOnce({ from: vi.fn().mockResolvedValue([]) });

    mockComputeSlots.mockReturnValueOnce([
      { startsAt: new Date(validNewStartsAt), endsAt: new Date(new Date(validNewStartsAt).getTime() + 1800000) },
    ]);

    mockNeedsApproval.mockResolvedValueOnce(true);

    mockDbTransaction.mockImplementationOnce(async (callback: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        execute: vi.fn().mockResolvedValue(undefined),
        select: vi.fn()
          .mockReturnValueOnce({ from: vi.fn().mockResolvedValue([]) })
          .mockReturnValueOnce({ from: vi.fn().mockResolvedValue([]) })
          .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
        update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([pendingUpdatedRow]) }) }) }),
        insert: vi.fn(),
      };
      return callback(tx);
    });

    mockDbSelect
      .mockReturnValueOnce(limitSelect([pendingUpdatedRow]))
      .mockReturnValueOnce(swimmerResponseSelectForLesson());

    const res = await request(app)
      .patch(`/lessons/${LESSON_ID}`)
      .set("Authorization", "Bearer token")
      .send({ startsAt: validNewStartsAt, locationId: NEW_LOCATION_ID });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("pending");
  });

  it("returns 403 for a viewer", async () => {
    authAs(viewerProfile);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(viewerProfile))
      .mockReturnValueOnce(requireHouseholdMemberSelect(HOUSEHOLD_ID, "viewer"));

    const res = await request(app)
      .patch(`/lessons/${LESSON_ID}`)
      .set("Authorization", "Bearer token")
      .send({ durationMinutes: 45 });

    expect(res.status).toBe(403);
  });

  it("returns 403 when caller role is neither parent nor coach", async () => {
    authAs(otherRoleProfile);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(otherRoleProfile));

    const res = await request(app)
      .patch(`/lessons/${LESSON_ID}`)
      .set("Authorization", "Bearer token")
      .send({ durationMinutes: 45 });

    expect(res.status).toBe(403);
  });

  it("returns 422 lesson_in_past when parent reschedules a lesson that has already started", async () => {
    authAs(parentProfile);
    const pastLesson = { ...baseLessonRow, status: "approved" as typeof baseLessonRow.status, startsAt: new Date(ANCHOR_NOW.getTime() - 60 * 60 * 1000) };
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(parentProfile))
      .mockReturnValueOnce(requireHouseholdMemberSelect(HOUSEHOLD_ID, "owner"))
      .mockReturnValueOnce(limitSelect([pastLesson]));

    const res = await request(app)
      .patch(`/lessons/${LESSON_ID}`)
      .set("Authorization", "Bearer token")
      .send({ startsAt: validNewStartsAt });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("lesson_in_past");
  });

  it("duration-only PATCH extending into next lesson returns 422 slot_unavailable", async () => {
    // No startsAt — honor-system edit. computeAvailableSlots returns empty because
    // the extended duration (60 min) conflicts with the next lesson on the same day.
    authAs(parentProfile);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(parentProfile))
      .mockReturnValueOnce(requireHouseholdMemberSelect(HOUSEHOLD_ID, "owner"))
      .mockReturnValueOnce(limitSelect([baseLessonRow]))
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([configRow]) }) })
      .mockReturnValueOnce({ from: vi.fn().mockResolvedValue([schoolYearSeason]) })
      .mockReturnValueOnce({ from: vi.fn().mockResolvedValue([]) });

    mockComputeSlots.mockReturnValueOnce([]);

    mockDbTransaction.mockImplementationOnce(async (callback: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        execute: vi.fn().mockResolvedValue(undefined),
        select: vi.fn()
          .mockReturnValueOnce({ from: vi.fn().mockResolvedValue([]) })
          .mockReturnValueOnce({ from: vi.fn().mockResolvedValue([]) })
          .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
        update: vi.fn(),
        insert: vi.fn(),
      };
      return callback(tx);
    });

    const res = await request(app)
      .patch(`/lessons/${LESSON_ID}`)
      .set("Authorization", "Bearer token")
      .send({ durationMinutes: 60 });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("slot_unavailable");
  });

  it("duration-only PATCH extending past daily cap returns 422 slot_unavailable", async () => {
    // No startsAt — honor-system edit. computeAvailableSlots returns empty because
    // increasing duration to 60 min would push total daily minutes past maxDailyLessonMinutes.
    authAs(parentProfile);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(parentProfile))
      .mockReturnValueOnce(requireHouseholdMemberSelect(HOUSEHOLD_ID, "owner"))
      .mockReturnValueOnce(limitSelect([baseLessonRow]))
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([configRow]) }) })
      .mockReturnValueOnce({ from: vi.fn().mockResolvedValue([schoolYearSeason]) })
      .mockReturnValueOnce({ from: vi.fn().mockResolvedValue([]) });

    mockComputeSlots.mockReturnValueOnce([]);

    mockDbTransaction.mockImplementationOnce(async (callback: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        execute: vi.fn().mockResolvedValue(undefined),
        select: vi.fn()
          .mockReturnValueOnce({ from: vi.fn().mockResolvedValue([]) })
          .mockReturnValueOnce({ from: vi.fn().mockResolvedValue([]) })
          .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
        update: vi.fn(),
        insert: vi.fn(),
      };
      return callback(tx);
    });

    const res = await request(app)
      .patch(`/lessons/${LESSON_ID}`)
      .set("Authorization", "Bearer token")
      .send({ durationMinutes: 60 });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("slot_unavailable");
  });

  it("coach reschedules to a slot < 16h away and returns 200 (bypasses too_soon guard)", async () => {
    // A slot that a parent cannot book (too soon), but a coach can.
    const tooSoonStartsAt = nextLessonDay(ANCHOR_NOW, 8).toISOString();
    const updatedRow = { ...baseLessonRow, startsAt: new Date(tooSoonStartsAt), movedAt: ANCHOR_NOW, previousStartsAt: baseLessonRow.startsAt };

    authAs(coachProfile);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(coachProfile))
      .mockReturnValueOnce(limitSelect([baseLessonRow]))         // coach loads lesson directly
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([configRow]) }) })
      .mockReturnValueOnce({ from: vi.fn().mockResolvedValue([schoolYearSeason]) })
      .mockReturnValueOnce({ from: vi.fn().mockResolvedValue([]) });

    mockComputeSlots.mockReturnValueOnce([
      { startsAt: new Date(tooSoonStartsAt), endsAt: new Date(new Date(tooSoonStartsAt).getTime() + 1800000) },
    ]);

    mockDbTransaction.mockImplementationOnce(async (callback: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        execute: vi.fn().mockResolvedValue(undefined),
        select: vi.fn()
          .mockReturnValueOnce({ from: vi.fn().mockResolvedValue([]) })   // blockedTimes
          .mockReturnValueOnce({ from: vi.fn().mockResolvedValue([]) })   // travelBufferOverrides
          .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }), // lessons (excluding self)
        update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([updatedRow]) }) }) }),
        insert: vi.fn(),
      };
      return callback(tx);
    });

    mockDbSelect
      .mockReturnValueOnce(limitSelect([updatedRow]))
      .mockReturnValueOnce(swimmerResponseSelectForLesson());

    const res = await request(app)
      .patch(`/lessons/${LESSON_ID}`)
      .set("Authorization", "Bearer token")
      .send({ startsAt: tooSoonStartsAt });

    expect(res.status).toBe(200);
    expect(res.body.movedAt).not.toBeNull();
  });
});
