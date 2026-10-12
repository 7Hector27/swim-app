import { vi, describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import pino from "pino";

const PROFILE_COACH_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const PROFILE_PARENT_ID = "bbbbbbbb-0000-0000-0000-000000000002";
const SWIMMER_A_ID = "cccccccc-0000-0000-0000-000000000003";

const now = new Date("2025-01-01T00:00:00.000Z");

// ── Mocks ─────────────────────────────────────────────────────────────────────

const {
  mockGetUser,
  mockDbSelect,
  mockDbUpdate,
} = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockDbSelect: vi.fn(),
  mockDbUpdate: vi.fn(),
}));

vi.mock("../lib/supabase", () => ({
  supabase: { auth: { getUser: mockGetUser } },
}));

vi.mock("../db/client", () => ({
  db: {
    select: mockDbSelect,
    update: mockDbUpdate,
  },
}));

import { createApp } from "../app";

const logger = pino({ level: "silent" });
const app = createApp(logger);

// ── Fixtures ──────────────────────────────────────────────────────────────────

const profileCoach = {
  id: PROFILE_COACH_ID,
  role: "coach" as const,
  fullName: "Coach",
  phone: null,
  ageAttestedAt: now,
  disabledAt: null,
  createdAt: now,
  updatedAt: now,
};

const profileParent = {
  id: PROFILE_PARENT_ID,
  role: "parent" as const,
  fullName: "Parent A",
  phone: null,
  ageAttestedAt: now,
  disabledAt: null,
  createdAt: now,
  updatedAt: now,
};

const baseSwimmerRow = {
  id: SWIMMER_A_ID,
  firstName: "Alice",
  lastName: "Smith",
  birthDate: "2010-05-01",
  sex: "female" as const,
  isPublic: true,
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

function swimmersSelect(rows: typeof baseSwimmerRow[]) {
  const orderBy = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ orderBy });
  return { from: vi.fn().mockReturnValue({ where }) };
}

function swimmerSingleSelect(row: typeof baseSwimmerRow | null) {
  const limit = vi.fn().mockResolvedValue(row ? [row] : []);
  const where = vi.fn().mockReturnValue({ limit });
  return { from: vi.fn().mockReturnValue({ where }) };
}

function clubsSelect() {
  const where = vi.fn().mockResolvedValue([]);
  return { from: vi.fn().mockReturnValue({ where }) };
}

function regsSelect() {
  const where = vi.fn().mockResolvedValue([]);
  return { from: vi.fn().mockReturnValue({ where }) };
}

function guardianNamesSelect() {
  const where = vi.fn().mockResolvedValue([]);
  const innerJoin = vi.fn().mockReturnValue({ where });
  return { from: vi.fn().mockReturnValue({ innerJoin }) };
}

function guardiansSelect() {
  const where = vi.fn().mockResolvedValue([]);
  const innerJoin = vi.fn().mockReturnValue({ where });
  return { from: vi.fn().mockReturnValue({ innerJoin }) };
}

beforeEach(() => {
  vi.resetAllMocks();
});

// ── 401 on every route when unauthenticated ───────────────────────────────────

describe("unauthenticated", () => {
  it("GET /coach/swimmers → 401", async () => {
    const res = await request(app).get("/coach/swimmers");
    expect(res.status).toBe(401);
  });

  it("GET /coach/swimmers/:id → 401", async () => {
    const res = await request(app).get(`/coach/swimmers/${SWIMMER_A_ID}`);
    expect(res.status).toBe(401);
  });

  it("PATCH /coach/swimmers/:id/visibility → 401", async () => {
    const res = await request(app)
      .patch(`/coach/swimmers/${SWIMMER_A_ID}/visibility`)
      .send({ isPublic: false });
    expect(res.status).toBe(401);
  });
});

// ── Parent role blocked from coach routes ─────────────────────────────────────

describe("parent role restrictions", () => {
  beforeEach(() => {
    authAs(profileParent);
    mockDbSelect.mockReturnValue(requireUserSelect(profileParent));
  });

  it("GET /coach/swimmers → 403 for parent", async () => {
    const res = await request(app)
      .get("/coach/swimmers")
      .set("Authorization", "Bearer token");
    expect(res.status).toBe(403);
  });

  it("GET /coach/swimmers/:id → 403 for parent", async () => {
    const res = await request(app)
      .get(`/coach/swimmers/${SWIMMER_A_ID}`)
      .set("Authorization", "Bearer token");
    expect(res.status).toBe(403);
  });

  it("PATCH /coach/swimmers/:id/visibility → 403 for parent", async () => {
    const res = await request(app)
      .patch(`/coach/swimmers/${SWIMMER_A_ID}/visibility`)
      .set("Authorization", "Bearer token")
      .send({ isPublic: false });
    expect(res.status).toBe(403);
  });
});

// ── Input validation ──────────────────────────────────────────────────────────

describe("input validation", () => {
  beforeEach(() => {
    authAs(profileCoach);
    mockDbSelect.mockReturnValue(requireUserSelect(profileCoach));
  });

  it("GET /coach/swimmers/not-a-uuid → 422", async () => {
    const res = await request(app)
      .get("/coach/swimmers/not-a-uuid")
      .set("Authorization", "Bearer token");
    expect(res.status).toBe(422);
  });

  it("PATCH /coach/swimmers/:id/visibility with isPublic: true → 422", async () => {
    const res = await request(app)
      .patch(`/coach/swimmers/${SWIMMER_A_ID}/visibility`)
      .set("Authorization", "Bearer token")
      .send({ isPublic: true });
    expect(res.status).toBe(422);
  });

  it("PATCH /coach/swimmers/:id/visibility with missing body → 422", async () => {
    const res = await request(app)
      .patch(`/coach/swimmers/${SWIMMER_A_ID}/visibility`)
      .set("Authorization", "Bearer token")
      .send({});
    expect(res.status).toBe(422);
  });
});

// ── GET /coach/swimmers ───────────────────────────────────────────────────────

describe("GET /coach/swimmers", () => {
  it("returns swimmers list with currentLeagues, clubs, and guardianNames", async () => {
    authAs(profileCoach);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach))
      .mockReturnValueOnce(swimmersSelect([baseSwimmerRow]))
      .mockReturnValueOnce(clubsSelect())
      .mockReturnValueOnce(regsSelect())
      .mockReturnValueOnce(guardianNamesSelect());

    const res = await request(app)
      .get("/coach/swimmers")
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      id: SWIMMER_A_ID,
      lastName: "Smith",
      currentLeagues: [],
      clubs: [],
      guardianNames: [],
    });
  });

  it("returns empty array when no active swimmers", async () => {
    authAs(profileCoach);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach))
      .mockReturnValueOnce(swimmersSelect([]));

    const res = await request(app)
      .get("/coach/swimmers")
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// ── GET /coach/swimmers/:id ───────────────────────────────────────────────────

describe("GET /coach/swimmers/:id", () => {
  it("returns swimmer detail with guardians", async () => {
    authAs(profileCoach);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach))
      .mockReturnValueOnce(swimmerSingleSelect(baseSwimmerRow))
      .mockReturnValueOnce(clubsSelect())
      .mockReturnValueOnce(regsSelect())
      .mockReturnValueOnce(guardiansSelect());

    const res = await request(app)
      .get(`/coach/swimmers/${SWIMMER_A_ID}`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: SWIMMER_A_ID,
      guardians: [],
      guardianNames: [],
      currentLeagues: [],
    });
  });

  it("returns 404 for archived or missing swimmer", async () => {
    authAs(profileCoach);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileCoach))
      .mockReturnValueOnce(swimmerSingleSelect(null));

    const res = await request(app)
      .get(`/coach/swimmers/${SWIMMER_A_ID}`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(404);
  });
});

// ── PATCH /coach/swimmers/:id/visibility ─────────────────────────────────────

describe("PATCH /coach/swimmers/:id/visibility", () => {
  it("sets isPublic to false and returns 204", async () => {
    authAs(profileCoach);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(profileCoach));

    const returning = vi.fn().mockResolvedValue([{ id: SWIMMER_A_ID }]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    mockDbUpdate.mockReturnValue({ set });

    const res = await request(app)
      .patch(`/coach/swimmers/${SWIMMER_A_ID}/visibility`)
      .set("Authorization", "Bearer token")
      .send({ isPublic: false });

    expect(res.status).toBe(204);
    expect(set).toHaveBeenCalledWith({ isPublic: false });
  });

  it("returns 404 when swimmer not found", async () => {
    authAs(profileCoach);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(profileCoach));

    const returning = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    mockDbUpdate.mockReturnValue({ set });

    const res = await request(app)
      .patch(`/coach/swimmers/${SWIMMER_A_ID}/visibility`)
      .set("Authorization", "Bearer token")
      .send({ isPublic: false });

    expect(res.status).toBe(404);
  });
});
