import { vi, describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import pino from "pino";

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

const now = new Date("2025-09-15T00:00:00.000Z");

// A slot 48 h in the future — comfortably inside the 16 h min and 10-week max.
const futureStart = new Date(Date.now() + 48 * 60 * 60 * 1000);

// ── Mocks ─────────────────────────────────────────────────────────────────────

const {
  mockGetUser,
  mockDbSelect,
  mockDbInsert,
  mockDbUpdate,
  mockDbTransaction,
  mockComputeSlots,
  mockNeedsApproval,
} = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockDbSelect: vi.fn(),
  mockDbInsert: vi.fn(),
  mockDbUpdate: vi.fn(),
  mockDbTransaction: vi.fn(),
  mockComputeSlots: vi.fn(),
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

vi.mock("../lib/slots", () => ({
  computeAvailableSlots: mockComputeSlots,
}));

vi.mock("../lib/lessonApproval", () => ({
  needsApproval: mockNeedsApproval,
  notifyBookingCreated: vi.fn(),
  notifyLessonApproved: vi.fn(),
  notifyLessonDeclined: vi.fn(),
  chargeLessonComplete: vi.fn(),
  syncCalendarApproved: vi.fn(),
}));

import { createApp } from "../app";

const logger = pino({ level: "silent" });
const app = createApp(logger);

// ── Fixtures ──────────────────────────────────────────────────────────────────

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
  lessonDays: [1, 2, 3, 4, 5],
  schoolYearStartTime: "16:30",
  schoolYearEndTime: "20:30",
  summerMorningStartTime: "07:00",
  summerMorningEndTime: "11:00",
  summerEveningStartTime: "19:00",
  summerEveningEndTime: "21:00",
  maxDailyLessonMinutes: 240,
  bookingMinAdvanceHours: 16,
  bookingMaxAdvanceWeeks: 10,
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

// For available-slots Promise.all: 5 selects (blockedTimes, buffers, lessons share same pattern)
function setupAvailableSlotsSelects(configRows: unknown[], blockedRows: unknown[], bufferRows: unknown[], lessonRows: unknown[], endDateRows: unknown[]) {
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
  function makeFromWhereLimit(rows: unknown[]) {
    const limit = vi.fn().mockResolvedValue(rows);
    const where = vi.fn().mockReturnValue({ limit });
    return { from: vi.fn().mockReturnValue({ where }) };
  }
  mockDbSelect
    .mockReturnValueOnce(makeFromLimit(configRows))        // availabilityConfig.limit(1)
    .mockReturnValueOnce(makeFromDirect(blockedRows))       // blockedTimes
    .mockReturnValueOnce(makeFromDirect(bufferRows))        // travelBufferOverrides
    .mockReturnValueOnce(makeFromWhere(lessonRows))         // lessons.where(...)
    .mockReturnValueOnce(makeFromWhereLimit(endDateRows));  // seasonSummerEndDates.where(...).limit(1)
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

beforeEach(() => {
  vi.resetAllMocks();
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
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) }) }); // endDate

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
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) }) });

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
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) }) });

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
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) }) });

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
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) }) });

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
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) }) });

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
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) }) });

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
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) }) });

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
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) }) });

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

  it("uses the LA year (not UTC) when looking up season end date", async () => {
    authAs(parentProfile);
    // 2027-01-01T01:00:00Z = 2026-12-31 17:00 PST.
    // LA year = 2026, UTC year = 2027 — the bug would query year 2027.
    // Dec 31, 2026 is a Thursday (ISO day 4).
    // bookingMaxAdvanceWeeks: 14 (98 days) covers the ~79 days to Dec 31.
    // lessonDays explicitly includes Thursday (4) so the day check passes and
    // the season lookup is reached.
    const decStart = new Date("2027-01-01T01:00:00.000Z");
    const bigWindowConfig = {
      ...configRow,
      bookingMaxAdvanceWeeks: 14,
      lessonDays: [1, 2, 3, 4, 5], // Thursday (4) is a lesson day
    };
    const decLesson = {
      ...baseLessonRow,
      startsAt: decStart,
      expiresAt: new Date(decStart.getTime() - 16 * 60 * 60 * 1000) as Date | null,
    };

    // Capture the year argument passed to the season_summer_end_dates query.
    // Drizzle's eq(col, year) stores the year value in its SQL AST; we walk
    // the expression object to extract the first integer in a plausible year range.
    let capturedSeasonYear: number | undefined;
    function findYearInExpr(obj: unknown, depth: number, seen: Set<unknown>): number | undefined {
      if (depth > 10 || seen.has(obj)) return undefined;
      seen.add(obj);
      if (typeof obj === "number" && obj >= 2000 && obj <= 2100) return obj;
      if (typeof obj !== "object" || obj === null) return undefined;
      for (const v of Object.values(obj as Record<string, unknown>)) {
        const found = findYearInExpr(v, depth + 1, seen);
        if (found !== undefined) return found;
      }
      return undefined;
    }
    const endDateFromMock = vi.fn().mockReturnValue({
      where: vi.fn().mockImplementation((arg: unknown) => {
        capturedSeasonYear = findYearInExpr(arg, 0, new Set());
        return { limit: vi.fn().mockResolvedValue([{ endDate: "2026-08-31" }]) };
      }),
    });

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(parentProfile))
      .mockReturnValueOnce(requireHouseholdMemberSelect())
      .mockReturnValueOnce(limitSelect([namedLocationRow]))
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([swimmerRow]) }) })
      .mockReturnValueOnce({ from: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([bigWindowConfig]) }) }) // config
      .mockReturnValueOnce({ from: endDateFromMock }); // season end date (year captured above)

    mockComputeSlots.mockReturnValueOnce([{ startsAt: decStart, endsAt: new Date(decStart.getTime() + 1800000) }]);
    transactionThatInserts(decLesson, true);
    mockDbSelect.mockReturnValueOnce(swimmerResponseSelect());

    const res = await request(app)
      .post("/lessons")
      .set("Authorization", "Bearer token")
      .send({ ...validBody, startsAt: decStart.toISOString() });

    expect(res.status).toBe(201);
    // LA year (2026) must be used for the season lookup, not UTC year (2027).
    expect(capturedSeasonYear).toBe(2026);
  });
});
