import { vi, describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import pino from "pino";
import { CoachScheduleItemSchema } from "@swim-app/shared";

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
  mockGetHouseholdBalance,
  mockApplyLedgerEntry,
  mockRefundLessonCharge,
  mockRefundLessonsForStatusChange,
  mockGetLessonOutstandingChargeCents,
} = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockDbSelect: vi.fn(),
  mockDbInsert: vi.fn(),
  mockDbUpdate: vi.fn(),
  mockDbTransaction: vi.fn(),
  mockComputeSlots: vi.fn(),
  mockMergeSlotWindows: vi.fn(),
  // ADR 036 Phase 4 balance service — mocked at the module boundary so
  // unit tests don't have to teach their mocked `tx` chains about the
  // balance ledger. Real balance behavior is covered by
  // coachLessonsCharge / refundPaths integration tests against the
  // dedicated test Supabase stack.
  mockGetHouseholdBalance: vi.fn().mockResolvedValue(1_000_000_000),
  mockApplyLedgerEntry: vi.fn().mockResolvedValue("ledger-id-stub"),
  mockGetLessonOutstandingChargeCents: vi.fn().mockResolvedValue(null),
  mockRefundLessonCharge: vi
    .fn()
    .mockResolvedValue({ refunded: false, reason: "no_charge" }),
  mockRefundLessonsForStatusChange: vi.fn().mockResolvedValue(new Map()),
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
  // Takes (tx, lessonId, autoApproved); mocked to resolve to null so the
  // post-commit queueCoachNotificationSend becomes a no-op.
  notifyBookingCreated: vi.fn().mockResolvedValue(null),
  notifyLessonApproved: vi.fn(),
  notifyLessonDeclined: vi.fn(),
  queueCoachNotificationSend: vi.fn(),
  chargeLessonComplete: vi.fn(),
}));

// Keep the lesson-sync reconcile from running during unit tests — it would
// try to hit the DB on a microtask after each response. Integration tests
// cover the real behavior.
vi.mock("../services/googleCalendarSync", () => ({
  syncLessonToGoogle: vi.fn().mockResolvedValue(undefined),
}));

// Stub the outbox write for unit tests. Integration tests exercise the
// real transactional insert; here we only want the route handlers to run.
vi.mock("../services/emails/outbox", () => ({
  enqueueLessonEmail: vi.fn().mockResolvedValue("outbox-id-stub"),
}));

// Keep the post-commit email sender from running in unit tests — it would
// try to hit the DB on a microtask after each response.
vi.mock("../services/emails/sender", () => ({
  sendLessonEmailOutboxRow: vi.fn().mockResolvedValue(undefined),
}));

// The cron tick calls the outbox drain + scrub; stub them so the unit
// test doesn't hit the DB. Integration tests cover the real flow.
vi.mock("../services/emails/drain", () => ({
  drainLessonEmailOutbox: vi.fn().mockResolvedValue({ drained: 0, abandoned: 0 }),
  scrubLessonEmailPayloads: vi.fn().mockResolvedValue({ scrubbed: 0 }),
}));

vi.mock("../lib/slots", () => ({
  computeAvailableSlots: mockComputeSlots,
  mergeSlotWindows: mockMergeSlotWindows,
}));

vi.mock("../services/balance", () => ({
  getHouseholdBalance: mockGetHouseholdBalance,
  applyLedgerEntry: mockApplyLedgerEntry,
  refundLessonCharge: mockRefundLessonCharge,
  refundLessonsForStatusChange: mockRefundLessonsForStatusChange,
  getLessonOutstandingChargeCents: mockGetLessonOutstandingChargeCents,
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
  movedAt: null as Date | null,
  previousStartsAt: null as Date | null,
  googleCalendarEventId: null as string | null,
  calendarSyncStatus: "not_synced",
  calendarSyncError: null as string | null,
  calendarSyncAttempts: 0,
  // ADR 034: the new nullable columns on lessons live on the mock too so
  // read paths can discriminate live vs anonymized rows.
  anonymizedAt: null as Date | null,
  locationSnapshot: null as string | null,
  swimmerCount: null as number | null,
  createdAt: now,
  updatedAt: now,
};

const configRow = {
  id: "config-id-0000-0000-0000-000000000001",
  maxDailyLessonMinutes: 240,
  bookingMinAdvanceHours: 16,
  bookingMaxAdvanceWeeks: 10,
  defaultTeachesDays: [2, 3, 4, 5],
  defaultStartTime: "16:00:00",
  defaultEndTime: "20:00:00",
  createdAt: now,
  updatedAt: now,
};

// Season covering Mon/Tue/Wed/Fri (teachesDays [1,2,3,5]) with 16:30 start,
// 20:30 end. Dates in the past so it always applies for ANCHOR_NOW onward.
const schoolYearSeason = {
  id: "season-sy-01",
  name: "School year",
  startDate: "2020-01-01",
  teachesDays: [1, 2, 3, 5],
  weekdayStartTime: "16:30" as string | null,
  weekendStartTime: null as string | null,
  endTime: "20:30",
  startsAtDst: false,
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

// Auth runs exactly once in the unified coachRouter parent.
function authAsCoach() {
  authAs(coachProfile);
  mockDbSelect
    .mockReturnValueOnce(requireUserSelect(coachProfile)); // coachRouter requireUser (once)
}


beforeAll(() => {
  vi.useFakeTimers({ now: ANCHOR_NOW });
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.resetAllMocks();
  // resetAllMocks clears the .mockResolvedValue() defaults set in the
  // hoisted block, which leaves subsequent calls returning `undefined` —
  // fine when the caller ignores the return (pre-ADR 036 Phase 7) but
  // crashes once the refund email path reads `refund.refunded`. Re-seed
  // the balance mocks here so every test starts from a sane no-op state.
  mockGetHouseholdBalance.mockResolvedValue(1_000_000_000);
  mockApplyLedgerEntry.mockResolvedValue("ledger-id-stub");
  mockRefundLessonCharge.mockResolvedValue({
    refunded: false,
    reason: "no_charge",
  });
  mockRefundLessonsForStatusChange.mockResolvedValue(new Map());
});

// ── GET /coach/lessons ────────────────────────────────────────────────────────

describe("GET /coach/lessons", () => {
  it("returns lessons list", async () => {
    authAsCoach();

    // Lazy-expiry transaction. The handler wraps the UPDATE in a tx so the
    // outbox write for any expired lesson commits atomically.
    const updateReturning = vi.fn().mockResolvedValue([]);
    const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    mockDbTransaction.mockImplementationOnce(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({ update: vi.fn().mockReturnValue({ set: updateSet }) }),
    );

    // lessons query (now left-joins bookingBatches for batchId/batchMode).
    const orderBy = vi.fn().mockResolvedValue([pendingLessonRow]);
    const where = vi.fn().mockReturnValue({ orderBy });
    const leftJoin = vi.fn().mockReturnValue({ where, orderBy });
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockReturnValue({ leftJoin, where, orderBy }) });

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
    mockDbTransaction.mockImplementationOnce(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({ update: vi.fn().mockReturnValue({ set }) }),
    );

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
    mockDbTransaction.mockImplementationOnce(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({ update: vi.fn().mockReturnValue({ set }) }),
    );

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
    mockDbTransaction.mockImplementationOnce(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        update: vi.fn().mockReturnValue({ set }),
        // ADR 036 Phase 4: decline now acquires the per-household balance
        // advisory lock inside the same tx before writing the status
        // change. The balance service itself is mocked at the module
        // boundary (see top of file) so a no-op execute is enough here.
        execute: vi.fn().mockResolvedValue(undefined),
      }),
    );

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
    mockDbSelect.mockReturnValueOnce(requireUserSelect(parentProfile)); // coachRouter requireUser; requireCoach rejects

    const res = await request(app)
      .patch(`/coach/lessons/${LESSON_ID}/decline`)
      .set("Authorization", "Bearer token")
      .send({});

    expect(res.status).toBe(403);
  });
});

// ── POST /internal/cron/tick ──────────────────────────────────────────────────

describe("POST /internal/cron/tick", () => {
  // Stub the lease acquire + release chain. The handler now opens with
  // `db.insert(cronLeases)...onConflictDoUpdate(...).returning(...)` and
  // closes by `db.update(cronLeases).set(...).where(...)` in a finally.
  // The default implementation returns a row that matches the request's
  // holder so acquire succeeds; tests that want the "skip" branch
  // override this per-test.
  function mockLeaseAcquireSuccess(): void {
    const returning = vi.fn().mockResolvedValue([{ heldBy: "any", heldUntil: new Date() }]);
    const onConflictDoUpdate = vi.fn().mockReturnValue({ returning });
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
    mockDbInsert.mockImplementationOnce(() => ({ values }));
  }
  function mockLeaseRelease(): void {
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn().mockReturnValue({ where });
    mockDbUpdate.mockImplementationOnce(() => ({ set }));
  }

  beforeEach(async () => {
    process.env["CRON_SECRET"] = "test-cron-secret";
    const { __resetEnvCacheForTests } = await import("../lib/env");
    __resetEnvCacheForTests();
    // vi.resetAllMocks() wipes implementations set in vi.mock() factories.
    // Re-apply the drain + scrub mocks so the handler's `await … .drained`
    // and `.scrubbed` reads see concrete objects instead of undefined.
    const drainModule = await import("../services/emails/drain");
    vi.mocked(drainModule.drainLessonEmailOutbox).mockResolvedValue({ drained: 0, abandoned: 0 });
    vi.mocked(drainModule.scrubLessonEmailPayloads).mockResolvedValue({ scrubbed: 0 });
    // Each successful tick does acquire (insert) + release (update) once.
    mockLeaseAcquireSuccess();
    mockLeaseRelease();
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

  // After the state-change transaction, the cron queries active
  // coach_calendar_integrations to schedule light/full sync passes.
  // Unit tests mock the DB entirely, so stub that select to return no
  // active integrations (nothing to schedule).
  function mockNoActiveIntegrations(): void {
    const integrationWhere = vi.fn().mockResolvedValue([]);
    mockDbSelect.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({ where: integrationWhere }),
    });
  }

  it("expires pending lessons past their deadline", async () => {
    // ADR 036 Phase 4: the expired pass now also returns householdId +
    // requestedBy so it can issue per-household refunds. Shape the mock
    // row accordingly; refundLessonCharge itself is mocked at the module
    // boundary (see top of file).
    const expiredRow = {
      id: LESSON_ID,
      householdId: HOUSEHOLD_ID,
      requestedBy: PARENT_PROFILE_ID,
    };
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
        // Balance-lock acquisition per household — no-op in the unit test.
        execute: vi.fn().mockResolvedValue(undefined),
      };
      return callback(tx);
    });
    mockNoActiveIntegrations();

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
    mockNoActiveIntegrations();

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

    // Lazy-expiry update now runs inside a transaction so the outbox
    // write for expired lessons commits atomically. The returning
    // includes householdId + requestedBy so the lazy path can issue
    // the same refund the cron would have.
    const updateReturning = vi.fn().mockResolvedValue([
      { id: LESSON_ID, householdId: HOUSEHOLD_ID, requestedBy: PARENT_PROFILE_ID },
    ]);
    const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    mockDbTransaction.mockImplementationOnce(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        update: vi.fn().mockReturnValue({ set: updateSet }),
        // refundLessonsForStatusChange takes the per-household balance
        // advisory lock via tx.execute; no-op in the unit test.
        execute: vi.fn().mockResolvedValue(undefined),
      }),
    );

    // lessons query returns the now-expired row (left-joins batches)
    const orderBy = vi.fn().mockResolvedValue([expiredRow]);
    const where = vi.fn().mockReturnValue({ orderBy });
    const leftJoin = vi.fn().mockReturnValue({ where, orderBy });
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockReturnValue({ leftJoin, where, orderBy }) });

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

    // 1. lessons + leftJoin(lessonLocations) .where(...).orderBy() — ADR 034
    //    switched to LEFT JOIN so anonymized rows (locationId NULL) come
    //    through alongside live rows.
    const lessonsOrderBy = vi.fn().mockResolvedValue([lessonA, lessonB]);
    const lessonsWhere = vi.fn().mockReturnValue({ orderBy: lessonsOrderBy });
    const lessonsLeftJoin = vi.fn().mockReturnValue({ where: lessonsWhere });
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockReturnValue({ leftJoin: lessonsLeftJoin }) });

    // 2. lessonSwimmers + innerJoin(swimmers).leftJoin(swimmerClubs).leftJoin(clubs).where()
    const swimmerWhere = vi.fn().mockResolvedValue([
      { lessonId: LESSON_ID, swimmerId: SWIMMER_ID, firstName: "Alice", lastName: "Smith", clubName: null, otherClubName: null },
    ]);
    const swimmerLeftJoin2 = vi.fn().mockReturnValue({ where: swimmerWhere });
    const swimmerLeftJoin1 = vi.fn().mockReturnValue({ leftJoin: swimmerLeftJoin2 });
    const swimmerInnerJoin = vi.fn().mockReturnValue({ leftJoin: swimmerLeftJoin1 });
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockReturnValue({ innerJoin: swimmerInnerJoin }) });

    // 3. Promise.all of 6 selects: [configRows, bufferRows, blockedRows, existingLessonRows, seasonRows, overrideRows]
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
    // availabilitySeasons
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockResolvedValue([schoolYearSeason]) });
    // availabilityOverrides
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockResolvedValue([]) });

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

  it("returns 422 for a malformed date", async () => {
    authAsCoach();
    const res = await request(app)
      .get("/coach/schedule?date=not-a-date")
      .set("Authorization", "Bearer token");
    expect(res.status).toBe(422);
  });

  it("returns 422 for a calendar-invalid date", async () => {
    authAsCoach();
    const res = await request(app)
      .get("/coach/schedule?date=2025-13-45")
      .set("Authorization", "Bearer token");
    expect(res.status).toBe(422);
  });

  it("returns 422 for a date more than one year in the future", async () => {
    authAsCoach();
    const farFuture = new Date();
    farFuture.setFullYear(farFuture.getFullYear() + 2);
    const dateStr = farFuture.toISOString().slice(0, 10);
    const res = await request(app)
      .get(`/coach/schedule?date=${dateStr}`)
      .set("Authorization", "Bearer token");
    expect(res.status).toBe(422);
  });

  it("response body matches CoachScheduleItemSchema", async () => {
    authAsCoach();

    const lessonA = {
      id: LESSON_ID,
      householdId: HOUSEHOLD_ID,
      locationId: LOCATION_ID,
      locationName: "Egret Park",
      startsAt: new Date("2025-09-15T21:30:00.000Z"),
      durationMinutes: 30,
      type: "private" as const,
      status: "approved" as const,
      expiresAt: null as Date | null,
      approvedAt: new Date("2025-09-14T00:00:00.000Z") as Date | null,
      declinedAt: null as Date | null,
      declineReason: null as string | null,
      movedAt: null as Date | null,
      previousStartsAt: null as Date | null,
      createdAt: now,
    };

    // ADR 034: /coach/schedule uses LEFT JOIN on lessonLocations now.
    const lessonsOrderBy = vi.fn().mockResolvedValue([lessonA]);
    const lessonsWhere = vi.fn().mockReturnValue({ orderBy: lessonsOrderBy });
    const lessonsLeftJoin = vi.fn().mockReturnValue({ where: lessonsWhere });
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockReturnValue({ leftJoin: lessonsLeftJoin }) });

    const swimmerWhere = vi.fn().mockResolvedValue([
      { lessonId: LESSON_ID, swimmerId: SWIMMER_ID, firstName: "Alice", lastName: "Smith", clubName: null, otherClubName: null },
    ]);
    const swimmerLeftJoin2 = vi.fn().mockReturnValue({ where: swimmerWhere });
    const swimmerLeftJoin1 = vi.fn().mockReturnValue({ leftJoin: swimmerLeftJoin2 });
    const swimmerInnerJoin = vi.fn().mockReturnValue({ leftJoin: swimmerLeftJoin1 });
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockReturnValue({ innerJoin: swimmerInnerJoin }) });

    const configLimit = vi.fn().mockResolvedValue([configRow]);
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockReturnValue({ limit: configLimit }) });
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockResolvedValue([]) }); // travelBufferOverrides
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockResolvedValue([]) }); // blockedTimes
    const existingWhere = vi.fn().mockResolvedValue([
      { startsAt: lessonA.startsAt, durationMinutes: 30, locationId: LOCATION_ID },
    ]);
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: existingWhere }) });
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockResolvedValue([]) }); // availabilitySeasons
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockResolvedValue([]) }); // availabilityOverrides

    const poolWhere = vi.fn().mockResolvedValue([]);
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: poolWhere }) });

    mockComputeSlots.mockReturnValue([]);
    mockMergeSlotWindows.mockReturnValue([]);

    const res = await request(app)
      .get("/coach/schedule?date=2025-09-15")
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    const parsed = CoachScheduleItemSchema.array().safeParse(res.body);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((issue) => `${issue.path.join(".")} (${issue.message})`).join("; ");
      throw new Error(`Response did not match CoachScheduleItemSchema: ${detail}`);
    }
    expect(parsed.data.some((item) => item.type === "lesson")).toBe(true);
  });
});

// ── GET /coach/lessons/:id/notes ──────────────────────────────────────────────

describe("GET /coach/lessons/:id/notes", () => {
  it("returns notes tied to the lesson, newest first", async () => {
    authAsCoach();

    // lesson existence check
    const limitSelect = vi.fn().mockResolvedValue([{ id: LESSON_ID }]);
    const whereLesson = vi.fn().mockReturnValue({ limit: limitSelect });
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: whereLesson }) });

    const older = { id: "note-001", swimmerId: SWIMMER_ID, sessionId: null, lessonId: LESSON_ID, body: "Older note", createdBy: COACH_PROFILE_ID, createdAt: new Date("2025-01-01T10:00:00Z"), updatedAt: new Date("2025-01-01T10:00:00Z") };
    const newer = { id: "note-002", swimmerId: SWIMMER_ID, sessionId: null, lessonId: LESSON_ID, body: "Newer note", createdBy: COACH_PROFILE_ID, createdAt: new Date("2025-01-02T10:00:00Z"), updatedAt: new Date("2025-01-02T10:00:00Z") };

    const orderBy = vi.fn().mockResolvedValue([newer, older]);
    const where = vi.fn().mockReturnValue({ orderBy });
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where }) });

    const res = await request(app)
      .get(`/coach/lessons/${LESSON_ID}/notes`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].body).toBe("Newer note");
    expect(res.body[1].body).toBe("Older note");
  });

  it("returns empty array when no notes exist", async () => {
    authAsCoach();

    const limitSelect = vi.fn().mockResolvedValue([{ id: LESSON_ID }]);
    const whereLesson = vi.fn().mockReturnValue({ limit: limitSelect });
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: whereLesson }) });

    const orderBy = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ orderBy });
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where }) });

    const res = await request(app)
      .get(`/coach/lessons/${LESSON_ID}/notes`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns 404 when lesson does not exist", async () => {
    authAsCoach();

    const limitSelect = vi.fn().mockResolvedValue([]);
    const whereLesson = vi.fn().mockReturnValue({ limit: limitSelect });
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockReturnValue({ where: whereLesson }) });

    const res = await request(app)
      .get(`/coach/lessons/${LESSON_ID}/notes`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(404);
  });

  it("returns 403 for a parent", async () => {
    authAs(parentProfile);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(parentProfile));

    const res = await request(app)
      .get(`/coach/lessons/${LESSON_ID}/notes`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(403);
  });
});

// ── GET /coach/lessons/:id ────────────────────────────────────────────────────

describe("GET /coach/lessons/:id", () => {
  const lessonDetailRow = {
    id: LESSON_ID,
    householdId: HOUSEHOLD_ID,
    locationId: LOCATION_ID,
    locationName: "Egret Park",
    locationAddress: "45 Ovation",
    locationCity: "Irvine",
    locationState: "CA",
    locationZip: "92620",
    isHomePool: false,
    startsAt: futureStart,
    durationMinutes: 30 as 30 | 45 | 60,
    type: "private" as const,
    status: "pending" as const,
    expiresAt,
    approvedAt: null as Date | null,
    declinedAt: null as Date | null,
    declineReason: null as string | null,
    movedAt: null as Date | null,
    previousStartsAt: null as Date | null,
    createdAt: now,
    // ADR 034 anonymization markers — null on live rows.
    anonymizedAt: null as Date | null,
    locationSnapshot: null as string | null,
    swimmerCount: null as number | null,
  };

  function mockGetLessonDetail(
    row: typeof lessonDetailRow | null,
    swimmerRows: unknown[] = [],
    memberRows: { fullName: string | null }[] = [{ fullName: "Smith Family" }],
  ) {
    // 1. lesson + LEFT JOIN on location — ADR 034 switched to LEFT JOIN so
    //    anonymized rows (locationId NULL) come through alongside live rows.
    const lessonLimit = vi.fn().mockResolvedValue(row ? [row] : []);
    const lessonWhere = vi.fn().mockReturnValue({ limit: lessonLimit });
    const lessonLeftJoin = vi.fn().mockReturnValue({ where: lessonWhere });
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockReturnValue({ leftJoin: lessonLeftJoin }) });
    if (!row) return;

    // 2. swimmers: innerJoin + leftJoin + leftJoin + where
    const swimWhere = vi.fn().mockResolvedValue(swimmerRows);
    const leftJoin2 = vi.fn().mockReturnValue({ where: swimWhere });
    const leftJoin1 = vi.fn().mockReturnValue({ leftJoin: leftJoin2 });
    const swimInnerJoin = vi.fn().mockReturnValue({ leftJoin: leftJoin1 });
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockReturnValue({ innerJoin: swimInnerJoin }) });

    // 3. household members: innerJoin + where + orderBy + limit
    const memberLimit = vi.fn().mockResolvedValue(memberRows);
    const memberOrderBy = vi.fn().mockReturnValue({ limit: memberLimit });
    const memberWhere = vi.fn().mockReturnValue({ orderBy: memberOrderBy });
    const memberInnerJoin = vi.fn().mockReturnValue({ where: memberWhere });
    mockDbSelect.mockReturnValueOnce({ from: vi.fn().mockReturnValue({ innerJoin: memberInnerJoin }) });
  }

  it("returns lesson detail with householdName for a coach", async () => {
    authAsCoach();
    mockGetLessonDetail(lessonDetailRow);

    const res = await request(app)
      .get(`/coach/lessons/${LESSON_ID}`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: LESSON_ID,
      locationName: "Egret Park",
      householdName: "Smith Family",
      swimmers: [],
    });
  });

  it("returns 404 when the lesson does not exist", async () => {
    authAsCoach();
    mockGetLessonDetail(null);

    const res = await request(app)
      .get(`/coach/lessons/${LESSON_ID}`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(404);
  });

  it("returns 403 for a parent", async () => {
    authAs(parentProfile);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(parentProfile));

    const res = await request(app)
      .get(`/coach/lessons/${LESSON_ID}`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(403);
  });

  it("sets isHomePool true and returns address when location belongs to a household", async () => {
    authAsCoach();
    mockGetLessonDetail({ ...lessonDetailRow, locationName: "Home pool", isHomePool: true });

    const res = await request(app)
      .get(`/coach/lessons/${LESSON_ID}`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    expect(res.body.isHomePool).toBe(true);
    expect(res.body.locationAddress).toBe("45 Ovation");
  });

  // The scrubbed-member-doesn't-leak-null case is covered end-to-end by
  // the integration test in coachLessons.integration.test.ts: a
  // household where one member ran leave-deletion, then
  // GET /coach/lessons/:id resolves the remaining owner's name. Exercising
  // it against the real DB gives a stronger guarantee than a drizzle-SQL
  // inspection could — if drizzle ever rearranges the where tree, the
  // unit-level check would break for the wrong reason.
});
