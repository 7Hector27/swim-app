import { vi, describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import pino from "pino";

const PROFILE_PARENT_A_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const PROFILE_PARENT_B_ID = "bbbbbbbb-0000-0000-0000-000000000002";
const HOUSEHOLD_A_ID = "ffffffff-0000-0000-0000-000000000010";
const HOUSEHOLD_B_ID = "ffffffff-0000-0000-0000-000000000011";
const LOCATION_NAMED_ID = "cccccccc-0000-0000-0000-000000000001";
const LOCATION_HOME_A_ID = "cccccccc-0000-0000-0000-000000000002";

const now = new Date("2025-01-01T00:00:00.000Z");

// ── Mocks ─────────────────────────────────────────────────────────────────────

const {
  mockGetUser,
  mockDbSelect,
  mockDbInsert,
  mockDbUpdate,
  mockDbTransaction,
} = vi.hoisted(() => ({
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

import { createApp } from "../app";

const logger = pino({ level: "silent" });
const app = createApp(logger);

// ── Fixtures ──────────────────────────────────────────────────────────────────

const parentProfileA = {
  id: PROFILE_PARENT_A_ID,
  role: "parent" as const,
  fullName: "Parent A",
  phone: null,
  ageAttestedAt: now,
  disabledAt: null,
  createdAt: now,
  updatedAt: now,
};

const parentProfileB = {
  id: PROFILE_PARENT_B_ID,
  role: "parent" as const,
  fullName: "Parent B",
  phone: null,
  ageAttestedAt: now,
  disabledAt: null,
  createdAt: now,
  updatedAt: now,
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

const homeLocationRowA = {
  id: LOCATION_HOME_A_ID,
  name: "Home pool",
  address: "123 Main St",
  city: "Irvine",
  state: "CA",
  zip: "92620",
  householdId: HOUSEHOLD_A_ID,
  isActive: true,
  sortOrder: 99,
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
  found: boolean,
  householdId: string = HOUSEHOLD_A_ID,
  role: "owner" | "manager" | "viewer" = "owner",
) {
  const rows = found ? [{ householdId, role }] : [];
  const limit = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ limit });
  return { from: vi.fn().mockReturnValue({ where }) };
}

function locationsSelect(rows: typeof namedLocationRow[]) {
  const orderBy = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ orderBy });
  return { from: vi.fn().mockReturnValue({ where }) };
}

beforeEach(() => {
  vi.resetAllMocks();
});

// ── GET /locations ────────────────────────────────────────────────────────────

describe("GET /locations", () => {
  it("returns named pools and the caller's home pool", async () => {
    authAs(parentProfileA);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(parentProfileA))
      .mockReturnValueOnce(requireHouseholdMemberSelect(true))
      .mockReturnValueOnce(locationsSelect([namedLocationRow, homeLocationRowA]));

    const res = await request(app)
      .get("/locations")
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({ id: LOCATION_NAMED_ID, isHomePool: false });
    expect(res.body[1]).toMatchObject({ id: LOCATION_HOME_A_ID, isHomePool: true });
  });

  it("does not return a different household's home pool", async () => {
    authAs(parentProfileB);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(parentProfileB))
      .mockReturnValueOnce(requireHouseholdMemberSelect(true, HOUSEHOLD_B_ID))
      .mockReturnValueOnce(locationsSelect([namedLocationRow]));

    const res = await request(app)
      .get("/locations")
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ id: LOCATION_NAMED_ID, isHomePool: false });
  });

  it("returns 401 when unauthenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await request(app).get("/locations");
    expect(res.status).toBe(401);
  });
});

// ── PUT /households/mine/home-pool ────────────────────────────────────────────

describe("PUT /households/mine/home-pool", () => {
  it("creates a new home pool and returns 201", async () => {
    authAs(parentProfileA);

    const insertedRow = { ...homeLocationRowA };

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(parentProfileA))
      .mockReturnValueOnce(requireHouseholdMemberSelect(true));

    mockDbTransaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      const updateReturning = vi.fn().mockResolvedValue([]);
      const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
      const updateSet = vi.fn().mockReturnValue({ where: updateWhere });

      const insertReturning = vi.fn().mockResolvedValue([insertedRow]);
      const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });

      const tx = {
        update: vi.fn().mockReturnValue({ set: updateSet }),
        insert: vi.fn().mockReturnValue({ values: insertValues }),
      };

      return callback(tx);
    });


    const res = await request(app)
      .put("/households/mine/home-pool")
      .set("Authorization", "Bearer token")
      .send({ address: "123 Main St", city: "Irvine", state: "CA", zip: "92620" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: LOCATION_HOME_A_ID,
      isHomePool: true,
      isActive: true,
    });
  });

  it("second PUT deactivates prior home pool and creates a new one", async () => {
    authAs(parentProfileA);

    const newHomeRow = {
      ...homeLocationRowA,
      id: "cccccccc-0000-0000-0000-000000000099",
      address: "456 New St",
    };

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(parentProfileA))
      .mockReturnValueOnce(requireHouseholdMemberSelect(true));

    mockDbTransaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      const updateReturning = vi.fn().mockResolvedValue([{ id: homeLocationRowA.id }]);
      const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
      const updateSet = vi.fn().mockReturnValue({ where: updateWhere });

      const insertReturning = vi.fn().mockResolvedValue([newHomeRow]);
      const insertValues = vi.fn().mockReturnValue({ returning: insertReturning });

      const mockTx = {
        update: vi.fn().mockReturnValue({ set: updateSet }),
        insert: vi.fn().mockReturnValue({ values: insertValues }),
      };

      return callback(mockTx);
    });

    const res = await request(app)
      .put("/households/mine/home-pool")
      .set("Authorization", "Bearer token")
      .send({ address: "456 New St", city: "Irvine", state: "CA", zip: "92620" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ address: "456 New St", isHomePool: true });
  });

  it("returns 403 when the caller is not a household owner", async () => {
    authAs(parentProfileA);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(parentProfileA))
      .mockReturnValueOnce(requireHouseholdMemberSelect(true, HOUSEHOLD_A_ID, "viewer"));

    const res = await request(app)
      .put("/households/mine/home-pool")
      .set("Authorization", "Bearer token")
      .send({ address: "123 Main St", city: "Irvine", state: "CA", zip: "92620" });

    expect(res.status).toBe(403);
  });
});

// ── DELETE /households/mine/home-pool ─────────────────────────────────────────

describe("DELETE /households/mine/home-pool", () => {
  it("deactivates the active home pool and returns 204", async () => {
    authAs(parentProfileA);

    const updateReturning = vi.fn().mockResolvedValue([]);
    const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });

    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(parentProfileA))
      .mockReturnValueOnce(requireHouseholdMemberSelect(true));
    mockDbUpdate.mockReturnValue({ set: updateSet });

    const res = await request(app)
      .delete("/households/mine/home-pool")
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(204);
  });
});

// ── Coach cannot access parent locations route ────────────────────────────────

describe("coach role restrictions on locations", () => {
  it("GET /coach/locations returns 403 for parent", async () => {
    authAs(parentProfileA);
    mockDbSelect.mockReturnValueOnce(requireUserSelect(parentProfileA));

    const res = await request(app)
      .get("/coach/locations")
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(403);
  });
});
