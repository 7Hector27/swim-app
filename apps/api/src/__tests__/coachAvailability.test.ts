import { vi, describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import pino from "pino";

const COACH_PROFILE_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const PARENT_PROFILE_ID = "bbbbbbbb-0000-0000-0000-000000000002";
const LOCATION_A_ID = "cccccccc-0000-0000-0000-000000000001";
const LOCATION_B_ID = "cccccccc-0000-0000-0000-000000000002";
const BLOCKED_TIME_ID = "dddddddd-0000-0000-0000-000000000001";
const AVAILABILITY_CONFIG_ID = "eeeeeeee-0000-0000-0000-000000000001";

const now = new Date("2025-01-01T00:00:00.000Z");

// ── Mocks ─────────────────────────────────────────────────────────────────────

const {
  mockGetUser,
  mockDbSelect,
  mockDbInsert,
  mockDbUpdate,
  mockDbDelete,
} = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockDbSelect: vi.fn(),
  mockDbInsert: vi.fn(),
  mockDbUpdate: vi.fn(),
  mockDbDelete: vi.fn(),
}));

vi.mock("../lib/supabase", () => ({
  supabase: { auth: { getUser: mockGetUser } },
}));

vi.mock("../db/client", () => ({
  db: {
    select: mockDbSelect,
    insert: mockDbInsert,
    update: mockDbUpdate,
    delete: mockDbDelete,
  },
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

const namedLocationRow = {
  id: LOCATION_A_ID,
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

const _homeLocationRow = {
  id: LOCATION_B_ID,
  name: "Home pool",
  address: "123 Main St",
  city: "Irvine",
  state: "CA",
  zip: "92620",
  householdId: "ffffffff-0000-0000-0000-000000000010" as string | null,
  isActive: true,
  sortOrder: 99,
  createdAt: now,
  updatedAt: now,
};

const availabilityConfigRow = {
  id: AVAILABILITY_CONFIG_ID,
  maxDailyLessonMinutes: 240,
  bookingMinAdvanceHours: 16,
  bookingMaxAdvanceWeeks: 10,
  createdAt: now,
  updatedAt: now,
};

const blockedTimeRow = {
  id: BLOCKED_TIME_ID,
  startsAt: new Date("2025-06-01T10:00:00.000Z"),
  endsAt: new Date("2025-06-01T12:00:00.000Z"),
  note: null as string | null,
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

function simpleSelect<T>(rows: T[]) {
  const orderBy = vi.fn().mockResolvedValue(rows);
  const limit = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ orderBy, limit });
  return { from: vi.fn().mockReturnValue({ orderBy, where, limit }) };
}

// For queries that await .where() directly (no further chaining).
function whereResolveSelect<T>(rows: T[]) {
  const where = vi.fn().mockResolvedValue(rows);
  return { from: vi.fn().mockReturnValue({ where }) };
}

// For queries shaped .select().from().innerJoin().where() awaited directly.
function innerJoinWhereSelect<T>(rows: T[]) {
  const where = vi.fn().mockResolvedValue(rows);
  const innerJoin = vi.fn().mockReturnValue({ where });
  return { from: vi.fn().mockReturnValue({ innerJoin }) };
}

beforeEach(() => {
  vi.resetAllMocks();
});

// ── Auth fires exactly once per /coach/* request ──────────────────────────────

describe("auth fires exactly once per /coach/* request", () => {
  it("GET /coach/locations verifies the token exactly once", async () => {
    authAs(coachProfile);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(coachProfile))
      .mockReturnValueOnce(simpleSelect([namedLocationRow]));

    const res = await request(app)
      .get("/coach/locations")
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    expect(mockGetUser).toHaveBeenCalledTimes(1);
  });
});

// ── GET /coach/locations ──────────────────────────────────────────────────────

describe("GET /coach/locations", () => {
  it("returns only named pools, not home pools", async () => {
    authAs(coachProfile);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(coachProfile))
      .mockReturnValueOnce(simpleSelect([namedLocationRow]));

    const res = await request(app)
      .get("/coach/locations")
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ id: LOCATION_A_ID, isHomePool: false });
  });

  it("returns 403 for a parent", async () => {
    authAs(parentProfile);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(parentProfile));

    const res = await request(app)
      .get("/coach/locations")
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(403);
  });
});

// ── PATCH /coach/locations/:id ────────────────────────────────────────────────

describe("PATCH /coach/locations/:id", () => {
  it("returns 404 when the id belongs to a home pool", async () => {
    authAs(coachProfile);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(coachProfile));

    const updateReturning = vi.fn().mockResolvedValue([]);
    const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    mockDbUpdate.mockReturnValue({ set: updateSet });

    const res = await request(app)
      .patch(`/coach/locations/${LOCATION_B_ID}`)
      .set("Authorization", "Bearer token")
      .send({ name: "New Name" });

    expect(res.status).toBe(404);
  });
});

// ── PATCH /coach/availability-config ─────────────────────────────────────────

describe("PATCH /coach/availability-config", () => {
  it("updates the config successfully and returns 200", async () => {
    authAs(coachProfile);

    const updatedRow = { ...availabilityConfigRow, maxDailyLessonMinutes: 300 };

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(coachProfile))
      .mockReturnValueOnce(simpleSelect([availabilityConfigRow]));

    const updateReturning = vi.fn().mockResolvedValue([updatedRow]);
    const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    mockDbUpdate.mockReturnValue({ set: updateSet });

    const res = await request(app)
      .patch("/coach/availability-config")
      .set("Authorization", "Bearer token")
      .send({ maxDailyLessonMinutes: 300 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ maxDailyLessonMinutes: 300 });
  });
});

// ── POST /coach/blocked-times ─────────────────────────────────────────────────

describe("POST /coach/blocked-times", () => {
  it("returns 422 when endsAt is before or equal to startsAt", async () => {
    authAs(coachProfile);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(coachProfile));

    const res = await request(app)
      .post("/coach/blocked-times")
      .set("Authorization", "Bearer token")
      .send({
        startsAt: "2025-06-01T12:00:00Z",
        endsAt: "2025-06-01T10:00:00Z",
      });

    expect(res.status).toBe(422);
  });

  it("creates a blocked time and returns 201", async () => {
    authAs(coachProfile);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(coachProfile));

    const insertReturning = vi.fn().mockResolvedValue([blockedTimeRow]);
    const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });
    mockDbInsert.mockReturnValue({ values: insertValues });

    const res = await request(app)
      .post("/coach/blocked-times")
      .set("Authorization", "Bearer token")
      .send({
        startsAt: "2025-06-01T10:00:00Z",
        endsAt: "2025-06-01T12:00:00Z",
      });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: BLOCKED_TIME_ID });
  });
});

// ── GET /coach/blocked-times ──────────────────────────────────────────────────

describe("GET /coach/blocked-times", () => {
  it("returns blocked times ordered by startsAt", async () => {
    authAs(coachProfile);

    const secondRow = {
      ...blockedTimeRow,
      id: "dddddddd-0000-0000-0000-000000000002",
      startsAt: new Date("2025-07-01T10:00:00.000Z"),
      endsAt: new Date("2025-07-01T12:00:00.000Z"),
    };

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(coachProfile))
      .mockReturnValueOnce(simpleSelect([blockedTimeRow, secondRow]));

    const res = await request(app)
      .get("/coach/blocked-times")
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({ id: BLOCKED_TIME_ID });
  });
});

// ── DELETE /coach/blocked-times/:id ──────────────────────────────────────────

describe("DELETE /coach/blocked-times/:id", () => {
  it("deletes a blocked time and returns 204", async () => {
    authAs(coachProfile);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(coachProfile));

    const deleteReturning = vi.fn().mockResolvedValue([{ id: BLOCKED_TIME_ID }]);
    const deleteWhere = vi.fn().mockReturnValue({ returning: deleteReturning });
    mockDbDelete.mockReturnValue({ where: deleteWhere });

    const res = await request(app)
      .delete(`/coach/blocked-times/${BLOCKED_TIME_ID}`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(204);
  });

  it("returns 404 when the blocked time does not exist", async () => {
    authAs(coachProfile);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(coachProfile));

    const deleteReturning = vi.fn().mockResolvedValue([]);
    const deleteWhere = vi.fn().mockReturnValue({ returning: deleteReturning });
    mockDbDelete.mockReturnValue({ where: deleteWhere });

    const res = await request(app)
      .delete(`/coach/blocked-times/${BLOCKED_TIME_ID}`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(404);
  });
});

// ── PUT /coach/travel-buffers/:fromId/:toId ───────────────────────────────────

describe("PUT /coach/travel-buffers/:fromId/:toId", () => {
  it("returns 422 when fromId equals toId", async () => {
    authAs(coachProfile);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(coachProfile));

    const res = await request(app)
      .put(`/coach/travel-buffers/${LOCATION_A_ID}/${LOCATION_A_ID}`)
      .set("Authorization", "Bearer token")
      .send({ bufferMinutes: 15 });

    expect(res.status).toBe(422);
  });

  it("returns 422 when either id is a home pool", async () => {
    authAs(coachProfile);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(coachProfile))
      .mockReturnValueOnce(whereResolveSelect([{ id: LOCATION_A_ID }]));

    const res = await request(app)
      .put(`/coach/travel-buffers/${LOCATION_A_ID}/${LOCATION_B_ID}`)
      .set("Authorization", "Bearer token")
      .send({ bufferMinutes: 15 });

    expect(res.status).toBe(422);
  });

  it("upserts a travel buffer and returns 200", async () => {
    authAs(coachProfile);

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(coachProfile))
      .mockReturnValueOnce(whereResolveSelect([{ id: LOCATION_A_ID }, { id: LOCATION_B_ID }]));

    const upsertedRow = {
      fromLocationId: LOCATION_A_ID,
      toLocationId: LOCATION_B_ID,
      bufferMinutes: 15,
      createdAt: now,
    };

    const onConflictDoUpdate = vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([upsertedRow]) });
    const insertValues = vi.fn().mockReturnValue({ onConflictDoUpdate });
    mockDbInsert.mockReturnValue({ values: insertValues });

    const res = await request(app)
      .put(`/coach/travel-buffers/${LOCATION_A_ID}/${LOCATION_B_ID}`)
      .set("Authorization", "Bearer token")
      .send({ bufferMinutes: 15 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      fromLocationId: LOCATION_A_ID,
      toLocationId: LOCATION_B_ID,
      bufferMinutes: 15,
    });
  });
});

// ── DELETE /coach/travel-buffers/:fromId/:toId ────────────────────────────────

describe("DELETE /coach/travel-buffers/:fromId/:toId", () => {
  it("deletes a travel buffer and returns 204", async () => {
    authAs(coachProfile);

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(coachProfile))
      .mockReturnValueOnce(whereResolveSelect([{ id: LOCATION_A_ID }, { id: LOCATION_B_ID }]));

    const deleteReturning = vi.fn().mockResolvedValue([{ fromLocationId: LOCATION_A_ID }]);
    const deleteWhere = vi.fn().mockReturnValue({ returning: deleteReturning });
    mockDbDelete.mockReturnValue({ where: deleteWhere });

    const res = await request(app)
      .delete(`/coach/travel-buffers/${LOCATION_A_ID}/${LOCATION_B_ID}`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(204);
  });

  it("returns 404 when the travel buffer does not exist", async () => {
    authAs(coachProfile);

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(coachProfile))
      .mockReturnValueOnce(whereResolveSelect([{ id: LOCATION_A_ID }, { id: LOCATION_B_ID }]));

    const deleteReturning = vi.fn().mockResolvedValue([]);
    const deleteWhere = vi.fn().mockReturnValue({ returning: deleteReturning });
    mockDbDelete.mockReturnValue({ where: deleteWhere });

    const res = await request(app)
      .delete(`/coach/travel-buffers/${LOCATION_A_ID}/${LOCATION_B_ID}`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(404);
  });
});

// ── Availability seasons ─────────────────────────────────────────────────────

const SEASON_A_ID = "11111111-0000-0000-0000-000000000001";
const SEASON_B_ID = "11111111-0000-0000-0000-000000000002";
const OVERRIDE_A_ID = "22222222-0000-0000-0000-000000000001";
const LESSON_A_ID = "33333333-0000-0000-0000-000000000001";

function fromResolveSelect<T>(rows: T[]) {
  return { from: vi.fn().mockResolvedValue(rows) };
}

function seasonRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: SEASON_A_ID,
    name: "School year",
    startDate: "2025-08-15",
    teachesDays: [1, 2, 3, 4, 5, 6],
    weekdayStartTime: "15:00:00",
    weekendStartTime: "09:00:00",
    endTime: "20:00:00",
    startsAtDst: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function overrideRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: OVERRIDE_A_ID,
    kind: "day_off" as const,
    startDate: "2025-12-24",
    endDate: "2025-12-26",
    startTime: null as string | null,
    endTime: null as string | null,
    note: null as string | null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("POST /coach/seasons", () => {
  it("creates a valid season and returns 201 with warnings when a lesson now falls outside hours", async () => {
    authAs(coachProfile);

    const inserted = seasonRow({
      name: "Narrower season",
      startDate: "2099-05-01",
      teachesDays: [1, 2, 3, 4, 5, 6, 7],
      weekdayStartTime: "15:00",
      weekendStartTime: "15:00",
      endTime: "18:00",
    });
    // A lesson that starts at 22:00 UTC (3:00pm PDT) and runs 30 min falls
    // just inside the window; a lesson at 23:00 UTC (4:00pm) + 150 min (ends
    // 6:30 pm PDT) overflows the 18:00 close, so the new season triggers a
    // day_truncated warning.
    const lessonRow = {
      id: LESSON_A_ID,
      startsAt: new Date("2099-06-10T23:00:00.000Z"),
      durationMinutes: 150,
      poolName: "Egret Park",
    };
    const swimmerJoinRows = [{ lessonId: LESSON_A_ID, firstName: "Ava" }];

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(coachProfile))
      .mockReturnValueOnce(simpleSelect<unknown>([]))
      .mockReturnValueOnce(fromResolveSelect([inserted]))
      .mockReturnValueOnce(fromResolveSelect([]))
      .mockReturnValueOnce(innerJoinWhereSelect([lessonRow]))
      .mockReturnValueOnce(innerJoinWhereSelect(swimmerJoinRows));

    const insertReturning = vi.fn().mockResolvedValue([inserted]);
    const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });
    mockDbInsert.mockReturnValue({ values: insertValues });

    const res = await request(app)
      .post("/coach/seasons")
      .set("Authorization", "Bearer token")
      .send({
        name: "Narrower season",
        startDate: "2099-05-01",
        teachesDays: [1, 2, 3, 4, 5, 6, 7],
        weekdayStartTime: "15:00",
        weekendStartTime: "15:00",
        endTime: "18:00",
      });

    expect(res.status).toBe(201);
    expect(res.body.season).toMatchObject({ id: SEASON_A_ID });
    expect(res.body.warnings).toHaveLength(1);
    expect(res.body.warnings[0]).toMatchObject({
      lessonId: LESSON_A_ID,
      swimmerFirstNames: ["Ava"],
      poolName: "Egret Park",
    });
  });

  it("creates a valid season and returns 201 with empty warnings when nothing is impacted", async () => {
    authAs(coachProfile);

    const inserted = seasonRow({ name: "New season", startDate: "2026-01-05" });

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(coachProfile))
      .mockReturnValueOnce(simpleSelect<unknown>([]))
      .mockReturnValueOnce(fromResolveSelect([inserted]))
      .mockReturnValueOnce(fromResolveSelect([]))
      .mockReturnValueOnce(innerJoinWhereSelect([]));

    const insertReturning = vi.fn().mockResolvedValue([inserted]);
    const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });
    mockDbInsert.mockReturnValue({ values: insertValues });

    const res = await request(app)
      .post("/coach/seasons")
      .set("Authorization", "Bearer token")
      .send({
        name: "New season",
        startDate: "2026-01-05",
        teachesDays: [1, 2, 3, 4, 5, 6],
        weekdayStartTime: "15:00",
        weekendStartTime: "09:00",
        endTime: "20:00",
      });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ season: { id: SEASON_A_ID }, warnings: [] });
  });

  it("returns 422 invalid_time_granularity when start time is :07", async () => {
    authAs(coachProfile);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(coachProfile));

    const res = await request(app)
      .post("/coach/seasons")
      .set("Authorization", "Bearer token")
      .send({
        name: "Odd minute",
        startDate: "2026-01-05",
        teachesDays: [1, 2, 3, 4, 5],
        weekdayStartTime: "15:07",
        weekendStartTime: null,
        endTime: "20:00",
      });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: "invalid_time_granularity" });
  });

  it("returns 422 season_date_taken when another season has the same start_date", async () => {
    authAs(coachProfile);

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(coachProfile))
      .mockReturnValueOnce(simpleSelect([{ id: SEASON_B_ID }]));

    const res = await request(app)
      .post("/coach/seasons")
      .set("Authorization", "Bearer token")
      .send({
        name: "Duplicate",
        startDate: "2025-08-15",
        teachesDays: [1, 2, 3, 4, 5],
        weekdayStartTime: "15:00",
        weekendStartTime: null,
        endTime: "20:00",
      });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: "season_date_taken" });
  });

  it("returns 422 weekday_start_without_weekday when days=[6] and weekday time is set", async () => {
    authAs(coachProfile);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(coachProfile));

    const res = await request(app)
      .post("/coach/seasons")
      .set("Authorization", "Bearer token")
      .send({
        name: "Weekend only",
        startDate: "2026-02-01",
        teachesDays: [6],
        weekdayStartTime: "15:00",
        weekendStartTime: "09:00",
        endTime: "20:00",
      });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: "weekday_start_without_weekday" });
  });

  it("returns 422 weekday_start_required when days=[1] and weekday time is null", async () => {
    authAs(coachProfile);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(coachProfile));

    const res = await request(app)
      .post("/coach/seasons")
      .set("Authorization", "Bearer token")
      .send({
        name: "Weekday missing",
        startDate: "2026-02-01",
        teachesDays: [1],
        weekdayStartTime: null,
        weekendStartTime: null,
        endTime: "20:00",
      });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: "weekday_start_required" });
  });

  it("returns 403 for a parent", async () => {
    authAs(parentProfile);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(parentProfile));

    const res = await request(app)
      .post("/coach/seasons")
      .set("Authorization", "Bearer token")
      .send({
        name: "Nope",
        startDate: "2026-01-05",
        teachesDays: [1],
        weekdayStartTime: "15:00",
        weekendStartTime: null,
        endTime: "20:00",
      });

    expect(res.status).toBe(403);
  });
});

describe("DELETE /coach/seasons/:id", () => {
  it("returns warnings for upcoming lessons left outside hours with swimmer names and pool name", async () => {
    authAs(coachProfile);

    const deletedSeason = seasonRow();
    const lessonRow = {
      id: LESSON_A_ID,
      startsAt: new Date("2099-06-10T22:00:00.000Z"),
      durationMinutes: 30,
      poolName: "Egret Park",
    };
    const swimmerJoinRows = [
      { lessonId: LESSON_A_ID, firstName: "Ava" },
      { lessonId: LESSON_A_ID, firstName: "Max" },
    ];

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(coachProfile))
      .mockReturnValueOnce(fromResolveSelect([]))
      .mockReturnValueOnce(fromResolveSelect([]))
      .mockReturnValueOnce(innerJoinWhereSelect([lessonRow]))
      .mockReturnValueOnce(innerJoinWhereSelect(swimmerJoinRows));

    const deleteReturning = vi.fn().mockResolvedValue([deletedSeason]);
    const deleteWhere = vi.fn().mockReturnValue({ returning: deleteReturning });
    mockDbDelete.mockReturnValue({ where: deleteWhere });

    const res = await request(app)
      .delete(`/coach/seasons/${SEASON_A_ID}`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    expect(res.body.warnings).toHaveLength(1);
    expect(res.body.warnings[0]).toMatchObject({
      lessonId: LESSON_A_ID,
      reason: "day_closed",
      swimmerFirstNames: ["Ava", "Max"],
      poolName: "Egret Park",
    });
  });

  it("returns 404 when the season does not exist", async () => {
    authAs(coachProfile);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(coachProfile));

    const deleteReturning = vi.fn().mockResolvedValue([]);
    const deleteWhere = vi.fn().mockReturnValue({ returning: deleteReturning });
    mockDbDelete.mockReturnValue({ where: deleteWhere });

    const res = await request(app)
      .delete(`/coach/seasons/${SEASON_A_ID}`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(404);
  });
});

describe("PATCH /coach/seasons/:id", () => {
  it("updates fields and returns 200 with warnings", async () => {
    authAs(coachProfile);

    // Use HH:MM in the fixture so the API-layer time-granularity validator
    // (which expects HH:MM) accepts the fields the handler carries over from
    // `existing` for keys the body doesn't override.
    const existing = seasonRow({
      weekdayStartTime: "15:00",
      weekendStartTime: "09:00",
      endTime: "20:00",
    });
    const updated = { ...existing, endTime: "19:00" };

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(coachProfile))
      .mockReturnValueOnce(simpleSelect([existing]))
      .mockReturnValueOnce(fromResolveSelect([updated]))
      .mockReturnValueOnce(fromResolveSelect([]))
      .mockReturnValueOnce(innerJoinWhereSelect([]));

    const updateReturning = vi.fn().mockResolvedValue([updated]);
    const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    mockDbUpdate.mockReturnValue({ set: updateSet });

    const res = await request(app)
      .patch(`/coach/seasons/${SEASON_A_ID}`)
      .set("Authorization", "Bearer token")
      .send({ endTime: "19:00" });

    expect(res.status).toBe(200);
    expect(res.body.season.endTime).toBe("19:00");
    expect(res.body.warnings).toEqual([]);
  });

  it("returns 404 when the season does not exist", async () => {
    authAs(coachProfile);

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(coachProfile))
      .mockReturnValueOnce(simpleSelect<unknown>([]));

    const res = await request(app)
      .patch(`/coach/seasons/${SEASON_A_ID}`)
      .set("Authorization", "Bearer token")
      .send({ endTime: "19:00" });

    expect(res.status).toBe(404);
  });
});

describe("POST /coach/seasons/copy-next-year", () => {
  it("inserts next-year rows for every existing season on first call", async () => {
    authAs(coachProfile);

    const seasons = [
      seasonRow({ id: "11111111-0000-0000-0000-00000000000a", startDate: "2025-01-01" }),
      seasonRow({ id: "11111111-0000-0000-0000-00000000000b", startDate: "2025-04-01" }),
      seasonRow({ id: "11111111-0000-0000-0000-00000000000c", startDate: "2025-06-15" }),
      seasonRow({ id: "11111111-0000-0000-0000-00000000000d", startDate: "2025-08-15" }),
      seasonRow({ id: "11111111-0000-0000-0000-00000000000e", startDate: "2025-11-01" }),
    ];

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(coachProfile))
      .mockReturnValueOnce(fromResolveSelect(seasons));

    const insertedRows = seasons.map((season) =>
      seasonRow({
        id: `11111111-0000-0000-0000-00000000${(season.id as string).slice(-4)}`,
        startDate: `2026${(season.startDate as string).slice(4)}`,
      }),
    );
    const insertReturning = vi.fn().mockResolvedValue(insertedRows);
    const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });
    mockDbInsert.mockReturnValue({ values: insertValues });

    const res = await request(app)
      .post("/coach/seasons/copy-next-year")
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(201);
    expect(res.body.inserted).toHaveLength(5);
    expect(insertValues).toHaveBeenCalledTimes(1);
    const firstArg = insertValues.mock.calls[0]?.[0] as Array<{ startDate: string }>;
    expect(firstArg.map((row) => row.startDate)).toEqual([
      "2026-01-01",
      "2026-04-01",
      "2026-06-15",
      "2026-08-15",
      "2026-11-01",
    ]);
  });

  it("returns inserted:[] on second call when all next-year dates already exist", async () => {
    authAs(coachProfile);

    const seasons = [
      seasonRow({ id: "11111111-0000-0000-0000-00000000000a", startDate: "2025-01-01" }),
      seasonRow({ id: "11111111-0000-0000-0000-00000000000b", startDate: "2026-01-01" }),
    ];

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(coachProfile))
      .mockReturnValueOnce(fromResolveSelect(seasons));

    const res = await request(app)
      .post("/coach/seasons/copy-next-year")
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(201);
    expect(res.body.inserted).toEqual([]);
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it("skips seasons older than 12 months before the latest season's start_date", async () => {
    authAs(coachProfile);

    // Latest is 2026-05-15. Cutoff is 2025-05-15. The 2024 season is older
    // than the cutoff and must not be copied, even though its +1 year date
    // (2025-11-01) isn't already in the table.
    const seasons = [
      seasonRow({ id: "11111111-0000-0000-0000-00000000000a", startDate: "2024-11-01" }),
      seasonRow({ id: "11111111-0000-0000-0000-00000000000b", startDate: "2026-01-15" }),
      seasonRow({ id: "11111111-0000-0000-0000-00000000000c", startDate: "2026-05-15" }),
    ];

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(coachProfile))
      .mockReturnValueOnce(fromResolveSelect(seasons));

    const insertedRows = [
      seasonRow({ id: "11111111-0000-0000-0000-00000000001b", startDate: "2027-01-15" }),
      seasonRow({ id: "11111111-0000-0000-0000-00000000001c", startDate: "2027-05-15" }),
    ];
    const insertReturning = vi.fn().mockResolvedValue(insertedRows);
    const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });
    mockDbInsert.mockReturnValue({ values: insertValues });

    const res = await request(app)
      .post("/coach/seasons/copy-next-year")
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(201);
    expect(insertValues).toHaveBeenCalledTimes(1);
    const firstArg = insertValues.mock.calls[0]?.[0] as Array<{ startDate: string }>;
    expect(firstArg.map((row) => row.startDate)).toEqual(["2027-01-15", "2027-05-15"]);
  });

  it("shifts a DST-pinned season to the next year's second Sunday of March", async () => {
    authAs(coachProfile);

    const dstSeason = seasonRow({
      startDate: "2025-03-09",
      startsAtDst: true,
    });

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(coachProfile))
      .mockReturnValueOnce(fromResolveSelect([dstSeason]));

    const insertedRow = seasonRow({ startDate: "2026-03-08", startsAtDst: true });
    const insertReturning = vi.fn().mockResolvedValue([insertedRow]);
    const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });
    mockDbInsert.mockReturnValue({ values: insertValues });

    const res = await request(app)
      .post("/coach/seasons/copy-next-year")
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(201);
    expect(insertValues).toHaveBeenCalledTimes(1);
    const firstArg = insertValues.mock.calls[0]?.[0] as Array<{ startDate: string }>;
    expect(firstArg[0]?.startDate).toBe("2026-03-08");
  });
});

describe("POST /coach/overrides", () => {
  it("creates a day_off date range override and returns 201", async () => {
    authAs(coachProfile);

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(coachProfile))
      .mockReturnValueOnce(simpleSelect<unknown>([]));

    const inserted = overrideRow();
    const insertReturning = vi.fn().mockResolvedValue([inserted]);
    const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });
    mockDbInsert.mockReturnValue({ values: insertValues });

    const res = await request(app)
      .post("/coach/overrides")
      .set("Authorization", "Bearer token")
      .send({
        kind: "day_off",
        startDate: "2025-12-24",
        endDate: "2025-12-26",
      });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      override: { id: OVERRIDE_A_ID, kind: "day_off" },
      warnings: [],
    });
  });

  it("returns 422 custom_hours_date_mismatch when custom_hours spans multiple days", async () => {
    authAs(coachProfile);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(coachProfile));

    const res = await request(app)
      .post("/coach/overrides")
      .set("Authorization", "Bearer token")
      .send({
        kind: "custom_hours",
        startDate: "2025-07-04",
        endDate: "2025-07-05",
        startTime: "09:00",
        endTime: "12:00",
      });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: "custom_hours_date_mismatch" });
  });

  it("returns 422 override_conflict when overlapping an existing override", async () => {
    authAs(coachProfile);

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(coachProfile))
      .mockReturnValueOnce(simpleSelect([{ id: OVERRIDE_A_ID }]));

    const res = await request(app)
      .post("/coach/overrides")
      .set("Authorization", "Bearer token")
      .send({
        kind: "day_off",
        startDate: "2025-12-26",
        endDate: "2025-12-28",
      });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: "override_conflict" });
  });

  it("returns 422 override_conflict when a day_off and custom_hours overlap (kind-agnostic)", async () => {
    authAs(coachProfile);

    // Existing day_off; incoming custom_hours on a date inside that range.
    // Overlap is purely date-range based regardless of kind.
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(coachProfile))
      .mockReturnValueOnce(simpleSelect([{ id: OVERRIDE_A_ID }]));

    const res = await request(app)
      .post("/coach/overrides")
      .set("Authorization", "Bearer token")
      .send({
        kind: "custom_hours",
        startDate: "2025-12-25",
        endDate: "2025-12-25",
        startTime: "09:00",
        endTime: "12:00",
      });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: "override_conflict" });
  });

  it("returns 422 when note exceeds 500 characters", async () => {
    authAs(coachProfile);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(coachProfile));

    const res = await request(app)
      .post("/coach/overrides")
      .set("Authorization", "Bearer token")
      .send({
        kind: "day_off",
        startDate: "2025-12-24",
        endDate: "2025-12-26",
        note: "x".repeat(501),
      });

    expect(res.status).toBe(422);
  });

  it("returns 403 for a parent", async () => {
    authAs(parentProfile);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(parentProfile));

    const res = await request(app)
      .post("/coach/overrides")
      .set("Authorization", "Bearer token")
      .send({
        kind: "day_off",
        startDate: "2025-12-24",
        endDate: "2025-12-26",
      });

    expect(res.status).toBe(403);
  });
});

describe("PATCH /coach/overrides/:id", () => {
  it("updates fields and returns 200 with warnings", async () => {
    authAs(coachProfile);

    const existing = overrideRow();
    const updated = { ...existing, note: "updated note" };

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(coachProfile))
      .mockReturnValueOnce(simpleSelect([existing]))
      .mockReturnValueOnce(fromResolveSelect([]))
      .mockReturnValueOnce(fromResolveSelect([updated]))
      .mockReturnValueOnce(innerJoinWhereSelect([]));

    const updateReturning = vi.fn().mockResolvedValue([updated]);
    const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    mockDbUpdate.mockReturnValue({ set: updateSet });

    const res = await request(app)
      .patch(`/coach/overrides/${OVERRIDE_A_ID}`)
      .set("Authorization", "Bearer token")
      .send({ note: "updated note" });

    expect(res.status).toBe(200);
    expect(res.body.override.note).toBe("updated note");
    expect(res.body.warnings).toEqual([]);
  });

  it("re-checks overlap when the date range changes and returns 422 on conflict", async () => {
    authAs(coachProfile);

    const existing = overrideRow({ startDate: "2025-12-24", endDate: "2025-12-26" });
    const otherId = "22222222-0000-0000-0000-000000000002";

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(coachProfile))
      .mockReturnValueOnce(simpleSelect([existing]))
      .mockReturnValueOnce(simpleSelect([{ id: otherId }]));

    const res = await request(app)
      .patch(`/coach/overrides/${OVERRIDE_A_ID}`)
      .set("Authorization", "Bearer token")
      .send({ startDate: "2025-12-28", endDate: "2025-12-30" });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: "override_conflict" });
  });

  it("does not re-run the overlap check when only the note changes", async () => {
    authAs(coachProfile);

    const existing = overrideRow();
    const updated = { ...existing, note: "touched" };

    // Only requireUser select + existing select; no overlap select because
    // startDate/endDate didn't change.
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(coachProfile))
      .mockReturnValueOnce(simpleSelect([existing]))
      .mockReturnValueOnce(fromResolveSelect([]))
      .mockReturnValueOnce(fromResolveSelect([updated]))
      .mockReturnValueOnce(innerJoinWhereSelect([]));

    const updateReturning = vi.fn().mockResolvedValue([updated]);
    const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    mockDbUpdate.mockReturnValue({ set: updateSet });

    const res = await request(app)
      .patch(`/coach/overrides/${OVERRIDE_A_ID}`)
      .set("Authorization", "Bearer token")
      .send({ note: "touched" });

    expect(res.status).toBe(200);
  });

  it("returns 404 when the override does not exist", async () => {
    authAs(coachProfile);

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(coachProfile))
      .mockReturnValueOnce(simpleSelect<unknown>([]));

    const res = await request(app)
      .patch(`/coach/overrides/${OVERRIDE_A_ID}`)
      .set("Authorization", "Bearer token")
      .send({ note: "x" });

    expect(res.status).toBe(404);
  });
});

describe("DELETE /coach/overrides/:id", () => {
  it("deletes the override and returns 200 with warnings", async () => {
    authAs(coachProfile);

    const deleted = overrideRow();

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(coachProfile))
      .mockReturnValueOnce(fromResolveSelect([]))
      .mockReturnValueOnce(fromResolveSelect([]))
      .mockReturnValueOnce(innerJoinWhereSelect([]));

    const deleteReturning = vi.fn().mockResolvedValue([deleted]);
    const deleteWhere = vi.fn().mockReturnValue({ returning: deleteReturning });
    mockDbDelete.mockReturnValue({ where: deleteWhere });

    const res = await request(app)
      .delete(`/coach/overrides/${OVERRIDE_A_ID}`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    expect(res.body.warnings).toEqual([]);
  });

  it("returns 404 when the override does not exist", async () => {
    authAs(coachProfile);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(coachProfile));

    const deleteReturning = vi.fn().mockResolvedValue([]);
    const deleteWhere = vi.fn().mockReturnValue({ returning: deleteReturning });
    mockDbDelete.mockReturnValue({ where: deleteWhere });

    const res = await request(app)
      .delete(`/coach/overrides/${OVERRIDE_A_ID}`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(404);
  });
});

describe("GET /coach/availability-preview", () => {
  it("returns a day-by-day preview using effectiveHours", async () => {
    authAs(coachProfile);

    const schoolYear = seasonRow({
      startDate: "2025-08-15",
      teachesDays: [1, 2, 3, 4, 5, 6],
      weekdayStartTime: "15:00:00",
      weekendStartTime: "09:00:00",
      endTime: "20:00:00",
    });

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(coachProfile))
      .mockReturnValueOnce(fromResolveSelect([schoolYear]))
      .mockReturnValueOnce(fromResolveSelect([]));

    const res = await request(app)
      .get("/coach/availability-preview?from=2025-09-01&days=3")
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    expect(res.body.days).toHaveLength(3);
    for (const day of res.body.days) {
      expect(day.state).toBe("open");
    }
  });

  it("returns 403 for a parent", async () => {
    authAs(parentProfile);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(parentProfile));

    const res = await request(app)
      .get("/coach/availability-preview?from=2025-09-01&days=3")
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(403);
  });
});

