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
  lessonDays: [1, 2, 3, 5],
  schoolYearStartTime: "16:30",
  schoolYearEndTime: "20:30",
  summerMorningStartTime: "08:00",
  summerMorningEndTime: "14:00",
  summerEveningStartTime: "19:30",
  summerEveningEndTime: "21:00",
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

beforeEach(() => {
  vi.resetAllMocks();
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
  it("returns 422 when summerMorningEndTime is after 15:00", async () => {
    authAs(coachProfile);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(coachProfile));

    const res = await request(app)
      .patch("/coach/availability-config")
      .set("Authorization", "Bearer token")
      .send({ summerMorningEndTime: "16:00" });

    expect(res.status).toBe(422);
  });

  it("returns 422 when summerEveningStartTime is before 19:00", async () => {
    authAs(coachProfile);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(coachProfile));

    const res = await request(app)
      .patch("/coach/availability-config")
      .set("Authorization", "Bearer token")
      .send({ summerEveningStartTime: "18:00" });

    expect(res.status).toBe(422);
  });

  it("returns 422 when lessonDays contains a weekend day (day 6 fails schema max(5))", async () => {
    authAs(coachProfile);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(coachProfile));

    const res = await request(app)
      .patch("/coach/availability-config")
      .set("Authorization", "Bearer token")
      .send({ lessonDays: [6] });

    expect(res.status).toBe(422);
  });

  it("updates the config successfully and returns 200", async () => {
    authAs(coachProfile);

    const updatedRow = { ...availabilityConfigRow, schoolYearStartTime: "17:00" };

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
      .send({ schoolYearStartTime: "17:00" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ schoolYearStartTime: "17:00" });
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

// ── PATCH /coach/availability-config cross-field validation with existing config ──

describe("PATCH /coach/availability-config cross-field validation with existing config", () => {
  beforeEach(() => {
    authAs(coachProfile);
  });

  it("returns 422 when schoolYearEndTime patch creates start >= end with existing start", async () => {
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(coachProfile))
      .mockReturnValueOnce(simpleSelect([availabilityConfigRow]));

    const res = await request(app)
      .patch("/coach/availability-config")
      .set("Authorization", "Bearer token")
      .send({ schoolYearEndTime: "16:00" }); // existing start is "16:30", 16:30 >= 16:00

    expect(res.status).toBe(422);
  });

  it("returns 422 when summerMorningStartTime patch creates start >= end with existing end", async () => {
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(coachProfile))
      .mockReturnValueOnce(simpleSelect([availabilityConfigRow]));

    const res = await request(app)
      .patch("/coach/availability-config")
      .set("Authorization", "Bearer token")
      .send({ summerMorningStartTime: "14:30" }); // existing end is "14:00", 14:30 >= 14:00

    expect(res.status).toBe(422);
  });
});
