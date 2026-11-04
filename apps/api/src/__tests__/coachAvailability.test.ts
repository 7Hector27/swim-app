import { vi, describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import pino from "pino";
import { LessonLocationSchema } from "@swim-app/shared";

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
  mockDbTransaction,
} = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockDbSelect: vi.fn(),
  mockDbInsert: vi.fn(),
  mockDbUpdate: vi.fn(),
  mockDbDelete: vi.fn(),
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
    delete: mockDbDelete,
    transaction: mockDbTransaction,
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
  defaultTeachesDays: [2, 3, 4, 5],
  defaultStartTime: "16:00:00",
  defaultEndTime: "20:00:00",
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
  // Default transaction mock: pass-through so each test gets the same db
  // mocks inside the tx callback. Tests that need to assert transactional
  // behavior can re-mock locally.
  mockDbTransaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
    callback({
      select: mockDbSelect,
      insert: mockDbInsert,
      update: mockDbUpdate,
      delete: mockDbDelete,
    }),
  );
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

  // The /coach/book page consumes this exact endpoint via the web adapter
  // fetchCoachLocations. Guard the contract: the response must satisfy
  // LessonLocationSchema, inactive pools must be included (so the page can
  // choose whether to drop them), and the shape must preserve the fields
  // the booking UI relies on (name, isActive).
  it("response matches the shared LessonLocation shape and includes inactive pools", async () => {
    const activePool = { ...namedLocationRow };
    const inactivePool = {
      ...namedLocationRow,
      id: "cccccccc-0000-0000-0000-00000000000a",
      name: "Swallows Park (retired)",
      isActive: false,
      sortOrder: 2,
    };

    authAs(coachProfile);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(coachProfile))
      .mockReturnValueOnce(simpleSelect([activePool, inactivePool]));

    const res = await request(app)
      .get("/coach/locations")
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);

    // Parse the real body through the exact schema the web adapter uses.
    const parsed = LessonLocationSchema.array().safeParse(res.body);
    expect(parsed.success).toBe(true);

    const pools = parsed.success ? parsed.data : [];
    expect(pools.map((pool) => pool.name)).toEqual([
      "Egret Park",
      "Swallows Park (retired)",
    ]);

    // Mirrors the /coach/book filter: active pools only.
    const bookable = pools.filter((pool) => pool.isActive);
    expect(bookable).toHaveLength(1);
    expect(bookable[0]).toMatchObject({ name: "Egret Park", isHomePool: false });
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

// ── GET /coach/availability-config ───────────────────────────────────────────

describe("GET /coach/availability-config", () => {
  it("returns the config with default-hours fields normalized to HH:MM", async () => {
    authAs(coachProfile);

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(coachProfile))
      .mockReturnValueOnce(simpleSelect([availabilityConfigRow]));

    const res = await request(app)
      .get("/coach/availability-config")
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      defaultTeachesDays: [2, 3, 4, 5],
      defaultStartTime: "16:00",
      defaultEndTime: "20:00",
    });
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

  it("updates default hours and returns the new values", async () => {
    authAs(coachProfile);

    const updatedRow = {
      ...availabilityConfigRow,
      defaultTeachesDays: [1, 2, 3, 4, 5],
      defaultStartTime: "15:30:00",
      defaultEndTime: "19:45:00",
    };

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
      .send({
        defaultTeachesDays: [1, 2, 3, 4, 5],
        defaultStartTime: "15:30",
        defaultEndTime: "19:45",
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      defaultTeachesDays: [1, 2, 3, 4, 5],
      defaultStartTime: "15:30",
      defaultEndTime: "19:45",
    });
  });

  it("rejects times that are not on a 15-minute step", async () => {
    authAs(coachProfile);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(coachProfile));

    const res = await request(app)
      .patch("/coach/availability-config")
      .set("Authorization", "Bearer token")
      .send({ defaultStartTime: "16:10" });

    expect(res.status).toBe(422);
  });

  it("rejects an empty default teaches days array", async () => {
    authAs(coachProfile);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(coachProfile));

    const res = await request(app)
      .patch("/coach/availability-config")
      .set("Authorization", "Bearer token")
      .send({ defaultTeachesDays: [] });

    expect(res.status).toBe(422);
  });

  it("rejects when start >= end in the same request", async () => {
    authAs(coachProfile);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(coachProfile));

    const res = await request(app)
      .patch("/coach/availability-config")
      .set("Authorization", "Bearer token")
      .send({ defaultStartTime: "20:00", defaultEndTime: "16:00" });

    expect(res.status).toBe(422);
  });

  it("rejects when the resulting start >= stored end (only start is being changed)", async () => {
    authAs(coachProfile);

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(coachProfile))
      .mockReturnValueOnce(simpleSelect([availabilityConfigRow]));

    const res = await request(app)
      .patch("/coach/availability-config")
      .set("Authorization", "Bearer token")
      .send({ defaultStartTime: "21:00" });

    expect(res.status).toBe(422);
  });

  it("rejects coach impersonators (non-coach role is 403)", async () => {
    authAs(parentProfile);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(parentProfile));

    const res = await request(app)
      .patch("/coach/availability-config")
      .set("Authorization", "Bearer token")
      .send({ defaultStartTime: "16:00" });

    expect(res.status).toBe(403);
  });

  it("writes a coach_audit_log row with old and new values when bookingMinAdvanceHours changes", async () => {
    authAs(coachProfile);

    const previous = { ...availabilityConfigRow, bookingMinAdvanceHours: 16 };
    const updatedRow = { ...availabilityConfigRow, bookingMinAdvanceHours: 24 };

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(coachProfile))
      .mockReturnValueOnce(simpleSelect([previous]));

    const updateReturning = vi.fn().mockResolvedValue([updatedRow]);
    const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    mockDbUpdate.mockReturnValue({ set: updateSet });

    const insertValues = vi.fn().mockResolvedValue(undefined);
    mockDbInsert.mockReturnValue({ values: insertValues });

    const res = await request(app)
      .patch("/coach/availability-config")
      .set("Authorization", "Bearer token")
      .send({ bookingMinAdvanceHours: 24 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ bookingMinAdvanceHours: 24 });
    expect(insertValues).toHaveBeenCalledWith({
      coachId: COACH_PROFILE_ID,
      actorId: COACH_PROFILE_ID,
      action: "availability_config_booking_min_advance_hours_updated",
      payload: { previousValue: 16, newValue: 24 },
    });
  });

  it("does not write an audit row when bookingMinAdvanceHours is unchanged", async () => {
    authAs(coachProfile);

    const updatedRow = { ...availabilityConfigRow, bookingMinAdvanceHours: 16 };

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(coachProfile))
      .mockReturnValueOnce(simpleSelect([availabilityConfigRow]));

    const updateReturning = vi.fn().mockResolvedValue([updatedRow]);
    const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    mockDbUpdate.mockReturnValue({ set: updateSet });

    const insertValues = vi.fn().mockResolvedValue(undefined);
    mockDbInsert.mockReturnValue({ values: insertValues });

    const res = await request(app)
      .patch("/coach/availability-config")
      .set("Authorization", "Bearer token")
      .send({ bookingMinAdvanceHours: 16 });

    expect(res.status).toBe(200);
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("rejects bookingMinAdvanceHours outside [0, 168]", async () => {
    authAs(coachProfile);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(coachProfile));

    const res = await request(app)
      .patch("/coach/availability-config")
      .set("Authorization", "Bearer token")
      .send({ bookingMinAdvanceHours: 169 });

    expect(res.status).toBe(422);
  });

  it("accepts bookingMinAdvanceHours = 0", async () => {
    authAs(coachProfile);

    const previous = { ...availabilityConfigRow, bookingMinAdvanceHours: 16 };
    const updatedRow = { ...availabilityConfigRow, bookingMinAdvanceHours: 0 };

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(coachProfile))
      .mockReturnValueOnce(simpleSelect([previous]));

    const updateReturning = vi.fn().mockResolvedValue([updatedRow]);
    const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    mockDbUpdate.mockReturnValue({ set: updateSet });

    mockDbInsert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });

    const res = await request(app)
      .patch("/coach/availability-config")
      .set("Authorization", "Bearer token")
      .send({ bookingMinAdvanceHours: 0 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ bookingMinAdvanceHours: 0 });
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
    endDate: "2099-12-31",
    teachesDays: [1, 2, 3, 4, 5, 6],
    weekdayStartTime: "15:00:00",
    weekdayEndTime: "20:00:00",
    weekendStartTime: "09:00:00",
    weekendEndTime: "20:00:00",
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
      weekdayEndTime: "18:00",
      weekendStartTime: "15:00",
      weekendEndTime: "18:00",
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
      .mockReturnValueOnce(simpleSelect<unknown>([]))   // same startDate check
      .mockReturnValueOnce(simpleSelect<unknown>([]))   // findOverlappingSeason
      .mockReturnValueOnce(fromResolveSelect([inserted]))
      .mockReturnValueOnce(fromResolveSelect([]))
      .mockReturnValueOnce(simpleSelect([availabilityConfigRow]))
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
        endDate: "2099-12-31",
        teachesDays: [1, 2, 3, 4, 5, 6, 7],
        weekdayStartTime: "15:00",
        weekdayEndTime: "18:00",
        weekendStartTime: "15:00",
        weekendEndTime: "18:00",
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
      .mockReturnValueOnce(simpleSelect<unknown>([]))   // same startDate check
      .mockReturnValueOnce(simpleSelect<unknown>([]))   // findOverlappingSeason
      .mockReturnValueOnce(fromResolveSelect([inserted]))
      .mockReturnValueOnce(fromResolveSelect([]))
      .mockReturnValueOnce(simpleSelect([availabilityConfigRow]))
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
        endDate: "2026-12-31",
        teachesDays: [1, 2, 3, 4, 5, 6],
        weekdayStartTime: "15:00",
        weekdayEndTime: "20:00",
        weekendStartTime: "09:00",
        weekendEndTime: "20:00",
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
        endDate: "2026-12-31",
        teachesDays: [1, 2, 3, 4, 5],
        weekdayStartTime: "15:07",
        weekdayEndTime: "20:00",
        weekendStartTime: null,
        weekendEndTime: null,
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
        endDate: "2025-12-31",
        teachesDays: [1, 2, 3, 4, 5],
        weekdayStartTime: "15:00",
        weekdayEndTime: "20:00",
        weekendStartTime: null,
        weekendEndTime: null,
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
        endDate: "2026-12-31",
        teachesDays: [6],
        weekdayStartTime: "15:00",
        weekdayEndTime: null,
        weekendStartTime: "09:00",
        weekendEndTime: "20:00",
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
        endDate: "2026-12-31",
        teachesDays: [1],
        weekdayStartTime: null,
        weekdayEndTime: null,
        weekendStartTime: null,
        weekendEndTime: null,
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
        weekdayEndTime: "20:00",
        weekendStartTime: null,
        weekendEndTime: null,
      });

    expect(res.status).toBe(403);
  });

  it("returns 422 with season_overlap and conflictingSeasonName when dates overlap", async () => {
    authAs(coachProfile);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(coachProfile))
      .mockReturnValueOnce(simpleSelect([]))              // same startDate check
      .mockReturnValueOnce(simpleSelect([{ id: SEASON_B_ID, name: "School Year" }])); // findOverlappingSeason
    const res = await request(app)
      .post("/coach/seasons")
      .set("Authorization", "Bearer token")
      .send({
        name: "Duplicate range",
        startDate: "2025-08-16",
        endDate: "2026-01-31",
        teachesDays: [1, 2, 3, 4, 5],
        weekdayStartTime: "15:00",
        weekdayEndTime: "20:00",
        weekendStartTime: null,
        weekendEndTime: null,
      });
    expect(res.status).toBe(422);
    expect(res.body).toEqual({ error: "season_overlap", conflictingSeasonName: "School Year" });
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
      .mockReturnValueOnce(simpleSelect([availabilityConfigRow]))
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
    // After seasons are deleted, the default hours (Tue to Fri, 16:00 to 20:00)
    // apply. 2099-06-10 is a Wednesday, so the day is open per defaults, but
    // the lesson starts at 15:00 PDT, outside the 16:00 default window, so the
    // reason is outside_hours.
    expect(res.body.warnings[0]).toMatchObject({
      lessonId: LESSON_A_ID,
      reason: "outside_hours",
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

  it("returns 403 for a parent (coach-only)", async () => {
    authAs(parentProfile);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(parentProfile));

    const res = await request(app)
      .delete(`/coach/seasons/${SEASON_A_ID}`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(403);
    // Must not reach the delete handler at all when auth rejects.
    expect(mockDbDelete).not.toHaveBeenCalled();
  });

  it("after delete the slot engine falls back to defaults for those dates", async () => {
    // Verifies the user-facing promise: deleting a season does not just
    // return 200; GET /coach/availability-preview re-queries live DB
    // state and the previously-season-covered dates immediately read
    // the default hours (Tue to Fri, 16:00 to 20:00 per fixtures).
    authAs(coachProfile);

    const deletedSeason = seasonRow();

    // DELETE path: requireUser, then delete handler reads seasons /
    // overrides / config / upcoming for the warning computation.
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(coachProfile))
      .mockReturnValueOnce(fromResolveSelect([]))
      .mockReturnValueOnce(fromResolveSelect([]))
      .mockReturnValueOnce(simpleSelect([availabilityConfigRow]))
      .mockReturnValueOnce(innerJoinWhereSelect([]))
      // Preview GET path: requireUser, then the handler reads seasons,
      // overrides, config.
      .mockReturnValueOnce(requireUserSelect(coachProfile))
      .mockReturnValueOnce(fromResolveSelect([]))
      .mockReturnValueOnce(fromResolveSelect([]))
      .mockReturnValueOnce(simpleSelect([availabilityConfigRow]));

    const deleteReturning = vi.fn().mockResolvedValue([deletedSeason]);
    const deleteWhere = vi.fn().mockReturnValue({ returning: deleteReturning });
    mockDbDelete.mockReturnValue({ where: deleteWhere });

    const deleteRes = await request(app)
      .delete(`/coach/seasons/${SEASON_A_ID}`)
      .set("Authorization", "Bearer token");
    expect(deleteRes.status).toBe(200);

    // 2099-06-10 is a Wednesday (a default teaching day). With no
    // seasons left the preview reads straight from defaults.
    const previewRes = await request(app)
      .get("/coach/availability-preview?from=2099-06-10&days=1")
      .set("Authorization", "Bearer token");
    expect(previewRes.status).toBe(200);
    expect(previewRes.body.days).toHaveLength(1);
    expect(previewRes.body.days[0]).toMatchObject({
      date: "2099-06-10",
      state: "open",
      windows: [{ start: "16:00", end: "20:00" }],
    });
  });
});

describe("GET /coach/seasons/:id/delete-impact", () => {
  it("returns warnings for lessons that would fall outside defaults, without deleting", async () => {
    authAs(coachProfile);

    const existing = seasonRow();
    const lessonRow = {
      id: LESSON_A_ID,
      startsAt: new Date("2099-06-10T22:00:00.000Z"),
      durationMinutes: 30,
      poolName: "Egret Park",
    };
    const swimmerJoinRows = [{ lessonId: LESSON_A_ID, firstName: "Ava" }];

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(coachProfile))
      .mockReturnValueOnce(whereResolveSelect([existing]))
      .mockReturnValueOnce(fromResolveSelect([existing]))
      .mockReturnValueOnce(fromResolveSelect([]))
      .mockReturnValueOnce(simpleSelect([availabilityConfigRow]))
      .mockReturnValueOnce(innerJoinWhereSelect([lessonRow]))
      .mockReturnValueOnce(innerJoinWhereSelect(swimmerJoinRows));

    const res = await request(app)
      .get(`/coach/seasons/${SEASON_A_ID}/delete-impact`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    expect(res.body.warnings).toHaveLength(1);
    expect(res.body.warnings[0]).toMatchObject({
      lessonId: LESSON_A_ID,
      reason: "outside_hours",
      swimmerFirstNames: ["Ava"],
      poolName: "Egret Park",
    });
    // Dry-run: no delete must have been issued.
    expect(mockDbDelete).not.toHaveBeenCalled();
  });

  it("returns 404 when the season does not exist", async () => {
    authAs(coachProfile);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(coachProfile))
      .mockReturnValueOnce(whereResolveSelect([]));

    const res = await request(app)
      .get(`/coach/seasons/${SEASON_A_ID}/delete-impact`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(404);
    expect(mockDbDelete).not.toHaveBeenCalled();
  });

  it("returns 403 for a parent (coach-only)", async () => {
    authAs(parentProfile);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(parentProfile));

    const res = await request(app)
      .get(`/coach/seasons/${SEASON_A_ID}/delete-impact`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(403);
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
      weekdayEndTime: "20:00",
      weekendStartTime: "09:00",
      weekendEndTime: "20:00",
    });
    const updated = { ...existing, weekdayEndTime: "19:00" };

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(coachProfile))
      .mockReturnValueOnce(simpleSelect([existing]))
      .mockReturnValueOnce(fromResolveSelect([updated]))
      .mockReturnValueOnce(fromResolveSelect([]))
      .mockReturnValueOnce(simpleSelect([availabilityConfigRow]))
      .mockReturnValueOnce(innerJoinWhereSelect([]));

    const updateReturning = vi.fn().mockResolvedValue([updated]);
    const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    mockDbUpdate.mockReturnValue({ set: updateSet });

    const res = await request(app)
      .patch(`/coach/seasons/${SEASON_A_ID}`)
      .set("Authorization", "Bearer token")
      .send({ weekdayEndTime: "19:00" });

    expect(res.status).toBe(200);
    expect(res.body.season.weekdayEndTime).toBe("19:00");
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
      .send({ weekdayEndTime: "19:00" });

    expect(res.status).toBe(404);
  });

  it("returns 422 with season_overlap and conflictingSeasonName when patched dates overlap", async () => {
    authAs(coachProfile);
    const existing = seasonRow({
      teachesDays: [1, 2, 3, 4, 5],
      weekdayStartTime: "15:00",
      weekdayEndTime: "20:00",
      weekendStartTime: null,
      weekendEndTime: null,
    });
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(coachProfile))
      .mockReturnValueOnce(simpleSelect([existing]))       // fetch existing
      .mockReturnValueOnce(simpleSelect([{ id: SEASON_B_ID, name: "Winter" }])); // findOverlappingSeason
    const res = await request(app)
      .patch(`/coach/seasons/${SEASON_A_ID}`)
      .set("Authorization", "Bearer token")
      .send({ endDate: "2026-06-30" });
    expect(res.status).toBe(422);
    expect(res.body).toEqual({ error: "season_overlap", conflictingSeasonName: "Winter" });
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
      .mockReturnValueOnce(simpleSelect<unknown>([]))
      .mockReturnValueOnce(fromResolveSelect([]))
      .mockReturnValueOnce(fromResolveSelect([]))
      .mockReturnValueOnce(simpleSelect([availabilityConfigRow]))
      .mockReturnValueOnce(innerJoinWhereSelect([]));

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

  it("returns warnings when the new override closes a day with a booked lesson", async () => {
    authAs(coachProfile);

    const inserted = overrideRow({
      kind: "day_off",
      startDate: "2025-12-24",
      endDate: "2025-12-24",
    });

    // 2025-12-25T01:00 UTC === 2025-12-24 5pm LA (within default hours 16:00–20:00).
    // The new day_off override closes that day, so the lesson falls outside.
    const lessonStart = new Date("2025-12-25T01:00:00.000Z");

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(coachProfile))
      .mockReturnValueOnce(simpleSelect<unknown>([]))
      .mockReturnValueOnce(fromResolveSelect([]))
      .mockReturnValueOnce(fromResolveSelect([inserted]))
      .mockReturnValueOnce(simpleSelect([availabilityConfigRow]))
      .mockReturnValueOnce(
        innerJoinWhereSelect([
          {
            id: "99999999-0000-0000-0000-000000000001",
            startsAt: lessonStart,
            durationMinutes: 60,
            poolName: "Main Pool",
          },
        ]),
      )
      .mockReturnValueOnce(innerJoinWhereSelect([]));

    const insertReturning = vi.fn().mockResolvedValue([inserted]);
    const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });
    mockDbInsert.mockReturnValue({ values: insertValues });

    const res = await request(app)
      .post("/coach/overrides")
      .set("Authorization", "Bearer token")
      .send({
        kind: "day_off",
        startDate: "2025-12-24",
        endDate: "2025-12-24",
      });

    expect(res.status).toBe(201);
    expect(res.body.warnings).toHaveLength(1);
    expect(res.body.warnings[0]).toMatchObject({
      lessonId: "99999999-0000-0000-0000-000000000001",
      poolName: "Main Pool",
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
      .mockReturnValueOnce(simpleSelect([availabilityConfigRow]))
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
      .mockReturnValueOnce(simpleSelect([availabilityConfigRow]))
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
      .mockReturnValueOnce(simpleSelect([availabilityConfigRow]))
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
      weekdayEndTime: "20:00:00",
      weekendStartTime: "09:00:00",
      weekendEndTime: "20:00:00",
    });

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(coachProfile))
      .mockReturnValueOnce(fromResolveSelect([schoolYear]))
      .mockReturnValueOnce(fromResolveSelect([]))
      .mockReturnValueOnce(simpleSelect([availabilityConfigRow]));

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

