import { vi, describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import pino from "pino";

// All HTTP tests in this file mock both db/client and lib/supabase.
// Tests that require a real database are marked it.todo — they belong in a
// separate integration-test suite that runs against the local Supabase stack.

const PROFILE_A_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const PROFILE_B_ID = "bbbbbbbb-0000-0000-0000-000000000002";
const SWIMMER_A_ID = "cccccccc-0000-0000-0000-000000000003";
const SWIMMER_B_ID = "dddddddd-0000-0000-0000-000000000004";
const CLUB_ID = "eeeeeeee-0000-0000-0000-000000000005";
const HOUSEHOLD_A_ID = "ffffffff-0000-0000-0000-000000000010";

const now = new Date("2025-01-01T00:00:00.000Z");

const baseSwimmerRow = {
  id: SWIMMER_A_ID,
  firstName: "Alice",
  lastName: "Smith",
  birthDate: "2010-05-01",
  sex: "female" as const,
  isPublic: false,
  publicConsentAt: null,
  publicConsentBy: null,
  archivedAt: null,
  createdAt: now,
  updatedAt: now,
};

const baseClubRow = {
  id: "ffffffff-0000-0000-0000-000000000006",
  swimmerId: SWIMMER_A_ID,
  clubId: CLUB_ID,
  otherClubName: null,
  createdAt: now,
  updatedAt: now,
};

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

const profileA = {
  id: PROFILE_A_ID,
  role: "parent" as const,
  fullName: "Parent A",
  phone: null,
  ageAttestedAt: now,
  disabledAt: null,
  createdAt: now,
  updatedAt: now,
};

const profileB = {
  id: PROFILE_B_ID,
  role: "parent" as const,
  fullName: "Parent B",
  phone: null,
  ageAttestedAt: now,
  disabledAt: null,
  createdAt: now,
  updatedAt: now,
};

const profileCoach = {
  id: PROFILE_A_ID,
  role: "coach" as const,
  fullName: "Coach",
  phone: null,
  ageAttestedAt: now,
  disabledAt: null,
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

/** Returns a mock chain for requireUser: db.select().from().where() → [profile]. */
function requireUserSelect(profile: AnyProfile) {
  const where = vi.fn().mockResolvedValue([profile]);
  return { from: vi.fn().mockReturnValue({ where }) };
}

/**
 * Returns a mock chain for requireHouseholdMember:
 * db.select().from().where().limit() → [{ householdId, role }] or [].
 */
function requireHouseholdMemberSelect(found: boolean, role: "owner" | "manager" | "viewer" = "owner") {
  const rows = found ? [{ householdId: HOUSEHOLD_A_ID, role }] : [];
  const limit = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ limit });
  return { from: vi.fn().mockReturnValue({ where }) };
}

/**
 * Returns a mock chain for requireHouseholdSwimmer:
 * db.select().from().where().limit() → [{ id }] or [].
 */
function requireHouseholdSwimmerSelect(found: boolean) {
  const rows = found ? [{ id: SWIMMER_A_ID }] : [];
  const limit = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ limit });
  return { from: vi.fn().mockReturnValue({ where }) };
}

/** Returns a mock chain for fetchSwimmerWithClubs swimmer query → [row] or []. */
function swimmerSelect(row: ({ id: string } & Record<string, unknown>) | null) {
  const limit = vi.fn().mockResolvedValue(row ? [row] : []);
  const where = vi.fn().mockReturnValue({ limit });
  return { from: vi.fn().mockReturnValue({ where }) };
}

/** Returns a mock chain for fetchSwimmerWithClubs clubs query → rows. */
function clubsSelect(rows: typeof baseClubRow[] = []) {
  const where = vi.fn().mockResolvedValue(rows);
  return { from: vi.fn().mockReturnValue({ where }) };
}

/**
 * Returns a mock chain for registration queries → rows.
 * Include swimmerId when mocking the GET /me batch query; omit it for the
 * single-swimmer fetchSwimmerWithClubs path which only selects { league }.
 */
function regsSelect(
  rows: Array<{ swimmerId?: string; league: "club" | "summer_league" }> = [],
) {
  const where = vi.fn().mockResolvedValue(rows);
  return { from: vi.fn().mockReturnValue({ where }) };
}

/** Returns a mock chain for the registration existence check → row or null. */
function regCheckSelect(row: { id: string; withdrawnAt: Date | null } | null) {
  const limit = vi.fn().mockResolvedValue(row ? [row] : []);
  const where = vi.fn().mockReturnValue({ limit });
  return { from: vi.fn().mockReturnValue({ where }) };
}

beforeEach(() => {
  vi.resetAllMocks();
});

// ── 401 on every route when unauthenticated ───────────────────────────────────

describe("unauthenticated", () => {
  it("GET /clubs → 401", async () => {
    const res = await request(app).get("/clubs");
    expect(res.status).toBe(401);
  });

  it("POST /swimmers → 401", async () => {
    const res = await request(app).post("/swimmers").send({});
    expect(res.status).toBe(401);
  });

  it("GET /swimmers/me → 401", async () => {
    const res = await request(app).get("/swimmers/me");
    expect(res.status).toBe(401);
  });

  it("GET /swimmers/:id → 401", async () => {
    const res = await request(app).get(`/swimmers/${SWIMMER_A_ID}`);
    expect(res.status).toBe(401);
  });

  it("PATCH /swimmers/:id → 401", async () => {
    const res = await request(app).patch(`/swimmers/${SWIMMER_A_ID}`).send({ isPublic: true });
    expect(res.status).toBe(401);
  });

  it("DELETE /swimmers/:id → 401", async () => {
    const res = await request(app).delete(`/swimmers/${SWIMMER_A_ID}`);
    expect(res.status).toBe(401);
  });

  it("PUT /swimmers/:id/registrations/:league → 401", async () => {
    const res = await request(app).put(`/swimmers/${SWIMMER_A_ID}/registrations/club`);
    expect(res.status).toBe(401);
  });

  it("DELETE /swimmers/:id/registrations/:league → 401", async () => {
    const res = await request(app).delete(`/swimmers/${SWIMMER_A_ID}/registrations/club`);
    expect(res.status).toBe(401);
  });
});

// ── Coach role blocked from parent-only routes ───────────────────────────────

describe("coach role restrictions", () => {
  beforeEach(() => {
    authAs(profileCoach);
    mockDbSelect.mockReturnValue(requireUserSelect(profileCoach));
  });

  it("POST /swimmers → 403 for coach", async () => {
    const res = await request(app)
      .post("/swimmers")
      .set("Authorization", "Bearer token")
      .send({
        firstName: "Bob",
        lastName: "Jones",
        birthDate: "2012-01-01",
        sex: "male",
        isPublic: false,
        clubs: [],
      });
    expect(res.status).toBe(403);
  });

  it("GET /swimmers/me → 403 for coach", async () => {
    const res = await request(app)
      .get("/swimmers/me")
      .set("Authorization", "Bearer token");
    expect(res.status).toBe(403);
  });

  it("GET /swimmers/:id → 403 for coach", async () => {
    const res = await request(app)
      .get(`/swimmers/${SWIMMER_A_ID}`)
      .set("Authorization", "Bearer token");
    expect(res.status).toBe(403);
  });

  it("PATCH /swimmers/:id → 403 for coach", async () => {
    const res = await request(app)
      .patch(`/swimmers/${SWIMMER_A_ID}`)
      .set("Authorization", "Bearer token")
      .send({ firstName: "Hacked" });
    expect(res.status).toBe(403);
  });

  it("DELETE /swimmers/:id → 403 for coach", async () => {
    const res = await request(app)
      .delete(`/swimmers/${SWIMMER_A_ID}`)
      .set("Authorization", "Bearer token");
    expect(res.status).toBe(403);
  });
});

// ── Non-UUID id → 422, not 500 ────────────────────────────────────────────────

describe("invalid id format", () => {
  beforeEach(() => {
    authAs(profileA);
    // requireUser is the only DB call — validate() rejects the non-UUID before requireHouseholdMember
    mockDbSelect.mockReturnValue(requireUserSelect(profileA));
  });

  it("GET /swimmers/not-a-uuid → 422", async () => {
    const res = await request(app)
      .get("/swimmers/not-a-uuid")
      .set("Authorization", "Bearer token");
    expect(res.status).toBe(422);
  });

  it("PATCH /swimmers/not-a-uuid → 422", async () => {
    const res = await request(app)
      .patch("/swimmers/not-a-uuid")
      .set("Authorization", "Bearer token")
      .send({ isPublic: true });
    expect(res.status).toBe(422);
  });

  it("DELETE /swimmers/not-a-uuid → 422", async () => {
    const res = await request(app)
      .delete("/swimmers/not-a-uuid")
      .set("Authorization", "Bearer token");
    expect(res.status).toBe(422);
  });
});

// ── Parent isolation ──────────────────────────────────────────────────────────

describe("parent isolation", () => {
  beforeEach(() => {
    // Profile B is authenticated but swimmer A is not in B's household
    authAs(profileB);
    let call = 0;
    mockDbSelect.mockImplementation(() => {
      call++;
      if (call === 1) return requireUserSelect(profileB);
      if (call === 2) return requireHouseholdMemberSelect(true); // B has their own household
      return requireHouseholdSwimmerSelect(false); // swimmer A not in B's household
    });
  });

  it("GET /swimmers/:id → 404 for another parent's swimmer", async () => {
    const res = await request(app)
      .get(`/swimmers/${SWIMMER_A_ID}`)
      .set("Authorization", "Bearer token");
    expect(res.status).toBe(404);
  });

  it("PATCH /swimmers/:id → 404 for another parent's swimmer", async () => {
    const res = await request(app)
      .patch(`/swimmers/${SWIMMER_A_ID}`)
      .set("Authorization", "Bearer token")
      .send({ isPublic: true });
    expect(res.status).toBe(404);
  });

  it("DELETE /swimmers/:id → 404 for another parent's swimmer", async () => {
    const res = await request(app)
      .delete(`/swimmers/${SWIMMER_A_ID}`)
      .set("Authorization", "Bearer token");
    expect(res.status).toBe(404);
  });
});

// ── Archived swimmers ─────────────────────────────────────────────────────────

describe("archived swimmer", () => {
  it("GET /swimmers/:id → 404 when swimmer is archived", async () => {
    // requireHouseholdSwimmer filters archived_at IS NULL — returns empty → 404
    authAs(profileA);
    let call = 0;
    mockDbSelect.mockImplementation(() => {
      call++;
      if (call === 1) return requireUserSelect(profileA);
      if (call === 2) return requireHouseholdMemberSelect(true);
      return requireHouseholdSwimmerSelect(false); // archived → isNull(archivedAt) fails
    });

    const res = await request(app)
      .get(`/swimmers/${SWIMMER_A_ID}`)
      .set("Authorization", "Bearer token");
    expect(res.status).toBe(404);
  });

  it("GET /swimmers/me → does not include archived swimmer", async () => {
    authAs(profileA);
    let call = 0;
    mockDbSelect.mockImplementation(() => {
      call++;
      if (call === 1) return requireUserSelect(profileA);
      if (call === 2) return requireHouseholdMemberSelect(true);
      // active swimmers query — returns empty (archived_at IS NULL filters it out)
      const where = vi.fn().mockResolvedValue([]);
      return { from: vi.fn().mockReturnValue({ where }) };
    });

    const res = await request(app)
      .get("/swimmers/me")
      .set("Authorization", "Bearer token");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// ── Create atomicity ──────────────────────────────────────────────────────────
// Covered by the integration test suite (registrations.integration.test.ts and
// swimmers.integration.test.ts) which runs against local Supabase.

// ── Consent fields ────────────────────────────────────────────────────────────

describe("consent fields", () => {
  it("rejects publicConsentAt in POST body (strict schema → 422)", async () => {
    authAs(profileA);
    mockDbSelect
      .mockReturnValueOnce(requireUserSelect(profileA))
      .mockReturnValue(requireHouseholdMemberSelect(true));

    const res = await request(app)
      .post("/swimmers")
      .set("Authorization", "Bearer token")
      .send({
        firstName: "Bob",
        lastName: "Jones",
        birthDate: "2010-01-01",
        sex: "male",
        isPublic: true,
        publicConsentAt: "2000-01-01T00:00:00Z",
        clubs: [],
      });

    expect(res.status).toBe(422);
  });

  it("PATCH false→true sets publicConsentAt and publicConsentBy", async () => {
    authAs(profileA);
    const updatedSwimmer = {
      ...baseSwimmerRow,
      isPublic: true,
      publicConsentAt: now,
      publicConsentBy: PROFILE_A_ID,
    };
    let call = 0;
    mockDbSelect.mockImplementation(() => {
      call++;
      if (call === 1) return requireUserSelect(profileA);
      if (call === 2) return requireHouseholdMemberSelect(true);
      if (call === 3) return requireHouseholdSwimmerSelect(true);
      if (call === 4) return swimmerSelect(updatedSwimmer);
      if (call === 5) return clubsSelect();
      return regsSelect();
    });

    mockDbTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        select: () => {
          const limit = vi.fn().mockResolvedValue([{ isPublic: false }]);
          const where = vi.fn().mockReturnValue({ limit });
          return { from: vi.fn().mockReturnValue({ where }) };
        },
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
        }),
        delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
        insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
      };
      return fn(tx);
    });

    const res = await request(app)
      .patch(`/swimmers/${SWIMMER_A_ID}`)
      .set("Authorization", "Bearer token")
      .send({ isPublic: true });

    expect(res.status).toBe(200);
    expect(res.body.publicConsentAt).toBeTruthy();
  });

  it("PATCH true→false keeps consent fields (audit trail)", async () => {
    authAs(profileA);
    let call = 0;
    mockDbSelect.mockImplementation(() => {
      call++;
      if (call === 1) return requireUserSelect(profileA);
      if (call === 2) return requireHouseholdMemberSelect(true);
      if (call === 3) return requireHouseholdSwimmerSelect(true);
      if (call === 4) return swimmerSelect(baseSwimmerRow);
      if (call === 5) return clubsSelect();
      return regsSelect();
    });

    const setCaptured: Record<string, unknown>[] = [];
    mockDbTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        select: () => {
          // current swimmer has isPublic: true
          const limit = vi.fn().mockResolvedValue([{ isPublic: true }]);
          const where = vi.fn().mockReturnValue({ limit });
          return { from: vi.fn().mockReturnValue({ where }) };
        },
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockImplementation((fields: Record<string, unknown>) => {
            setCaptured.push(fields);
            return { where: vi.fn().mockResolvedValue([]) };
          }),
        }),
        delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
        insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
      };
      return fn(tx);
    });

    await request(app)
      .patch(`/swimmers/${SWIMMER_A_ID}`)
      .set("Authorization", "Bearer token")
      .send({ isPublic: false });

    // publicConsentAt/By must not be touched — they stay as the original audit trail
    expect(setCaptured[0]).not.toHaveProperty("publicConsentAt");
    expect(setCaptured[0]).not.toHaveProperty("publicConsentBy");
  });
});

// ── PATCH clubs-only ──────────────────────────────────────────────────────────

describe("PATCH clubs-only", () => {
  it("succeeds and does not call update on the swimmer row", async () => {
    authAs(profileA);
    let call = 0;
    mockDbSelect.mockImplementation(() => {
      call++;
      if (call === 1) return requireUserSelect(profileA);
      if (call === 2) return requireHouseholdMemberSelect(true);
      if (call === 3) return requireHouseholdSwimmerSelect(true);
      if (call === 4) return swimmerSelect(baseSwimmerRow);
      if (call === 5) return clubsSelect();
      return regsSelect();
    });

    const updateSpy = vi.fn();
    mockDbTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        select: () => {
          const limit = vi.fn().mockResolvedValue([{ isPublic: false }]);
          const where = vi.fn().mockReturnValue({ limit });
          return { from: vi.fn().mockReturnValue({ where }) };
        },
        update: vi.fn().mockImplementation(() => {
          updateSpy();
          return { set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) };
        }),
        delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
        insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
      };
      return fn(tx);
    });

    const res = await request(app)
      .patch(`/swimmers/${SWIMMER_A_ID}`)
      .set("Authorization", "Bearer token")
      .send({ clubs: [{ otherClubName: "Local Swim Club" }] });

    expect(res.status).toBe(200);
    expect(updateSpy).not.toHaveBeenCalled();
  });
});

// ── ParentSwimmerSchema parse ─────────────────────────────────────────────────
// Covered by the integration test suite (swimmers.integration.test.ts).

// ── Async error handling ──────────────────────────────────────────────────────

describe("async error handling", () => {
  it("returns 500 through errorHandler when a DB call throws", async () => {
    authAs(profileA);
    let call = 0;
    mockDbSelect.mockImplementation(() => {
      call++;
      if (call === 1) return requireUserSelect(profileA);
      if (call === 2) return requireHouseholdMemberSelect(true);
      throw new Error("DB connection failed");
    });

    const res = await request(app)
      .get("/swimmers/me")
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ error: "Internal server error" });
  });

  it("requireHouseholdMember DB error → 500", async () => {
    authAs(profileA);
    let call = 0;
    mockDbSelect.mockImplementation(() => {
      call++;
      if (call === 1) return requireUserSelect(profileA);
      throw new Error("DB connection failed");
    });

    const res = await request(app)
      .get("/swimmers/me")
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ error: "Internal server error" });
  });
});

// ── GET /clubs ────────────────────────────────────────────────────────────────

describe("GET /clubs", () => {
  it("returns active clubs as ISO-timestamped objects", async () => {
    authAs(profileA);
    const clubRow = { id: CLUB_ID, name: "Sharks", isActive: true, createdAt: now, updatedAt: now };
    let call = 0;
    mockDbSelect.mockImplementation(() => {
      call++;
      if (call === 1) return requireUserSelect(profileA);
      const where = vi.fn().mockResolvedValue([clubRow]);
      return { from: vi.fn().mockReturnValue({ where }) };
    });

    const res = await request(app).get("/clubs").set("Authorization", "Bearer token");
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ id: CLUB_ID, name: "Sharks", isActive: true });
    expect(typeof res.body[0].createdAt).toBe("string");
  });
});

// ── GET /swimmers/me ──────────────────────────────────────────────────────────

describe("GET /swimmers/me", () => {
  it("returns active swimmers with clubs and empty currentLeagues", async () => {
    authAs(profileA);
    let call = 0;
    mockDbSelect.mockImplementation(() => {
      call++;
      if (call === 1) return requireUserSelect(profileA);
      if (call === 2) return requireHouseholdMemberSelect(true);
      if (call === 3) {
        // active swimmers
        const where = vi.fn().mockResolvedValue([baseSwimmerRow]);
        return { from: vi.fn().mockReturnValue({ where }) };
      }
      if (call === 4) return clubsSelect([baseClubRow]); // Promise.all first
      return regsSelect();                               // Promise.all second
    });

    const res = await request(app).get("/swimmers/me").set("Authorization", "Bearer token");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(SWIMMER_A_ID);
    expect(res.body[0].clubs).toHaveLength(1);
    expect(res.body[0].currentLeagues).toEqual([]);
  });

  it("includes active league registrations in currentLeagues", async () => {
    authAs(profileA);
    let call = 0;
    mockDbSelect.mockImplementation(() => {
      call++;
      if (call === 1) return requireUserSelect(profileA);
      if (call === 2) return requireHouseholdMemberSelect(true);
      if (call === 3) {
        const where = vi.fn().mockResolvedValue([baseSwimmerRow]);
        return { from: vi.fn().mockReturnValue({ where }) };
      }
      if (call === 4) return clubsSelect();
      // GET /me batch query selects { swimmerId, league } — must include swimmerId
      // so leaguesBySwimmer.get(SWIMMER_A_ID) resolves correctly.
      return regsSelect([{ swimmerId: SWIMMER_A_ID, league: "club" }]);
    });

    const res = await request(app).get("/swimmers/me").set("Authorization", "Bearer token");
    expect(res.status).toBe(200);
    expect(res.body[0].currentLeagues).toEqual(["club"]);
  });

  it("returns empty array when caller has no swimmers", async () => {
    authAs(profileA);
    let call = 0;
    mockDbSelect.mockImplementation(() => {
      call++;
      if (call === 1) return requireUserSelect(profileA);
      if (call === 2) return requireHouseholdMemberSelect(true);
      // active swimmers returns empty
      const where = vi.fn().mockResolvedValue([]);
      return { from: vi.fn().mockReturnValue({ where }) };
    });

    const res = await request(app).get("/swimmers/me").set("Authorization", "Bearer token");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// ── POST /swimmers — audit log records the caller ────────────────────────────

describe("POST /swimmers", () => {
  it("inserts audit log row for the authenticated caller, not another profile", async () => {
    const createdSwimmer = { ...baseSwimmerRow, id: SWIMMER_B_ID };

    let postCall = 0;
    mockDbSelect.mockImplementation(() => {
      postCall++;
      if (postCall === 1) return requireUserSelect(profileB);
      if (postCall === 2) return requireHouseholdMemberSelect(true);
      // remaining calls (3=swimmerSelect, 4=clubsSelect, 5=regsSelect) come from fetchSwimmerWithClubs after transaction
      if (postCall === 3) return swimmerSelect(createdSwimmer);
      if (postCall === 4) return clubsSelect();
      return regsSelect();
    });

    authAs(profileB);

    mockDbTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const insertedAuditRows: unknown[] = [];
      const tx = {
        insert: vi.fn().mockImplementation(() => ({
          values: vi.fn().mockImplementation((vals: unknown) => {
            if (vals !== null && typeof vals === "object" && "actorId" in (vals as object)) {
              insertedAuditRows.push(vals);
            }
            return { returning: vi.fn().mockResolvedValue([createdSwimmer]) };
          }),
        })),
      };
      await fn(tx);
      expect(insertedAuditRows[0]).toMatchObject({ actorId: PROFILE_B_ID });
      return createdSwimmer;
    });

    const res = await request(app)
      .post("/swimmers")
      .set("Authorization", "Bearer token")
      .send({
        firstName: "Bob",
        lastName: "Jones",
        birthDate: "2012-03-10",
        sex: "male",
        isPublic: false,
        clubs: [],
      });

    expect(res.status).toBe(201);
  });
});

// ── Household role restrictions ───────────────────────────────────────────────

describe("household role restrictions", () => {
  it("viewer → 403 POST /swimmers", async () => {
    authAs(profileA);
    let call = 0;
    mockDbSelect.mockImplementation(() => {
      call++;
      if (call === 1) return requireUserSelect(profileA);
      return requireHouseholdMemberSelect(true, "viewer");
    });

    const res = await request(app)
      .post("/swimmers")
      .set("Authorization", "Bearer token")
      .send({
        firstName: "Bob",
        lastName: "Jones",
        birthDate: "2012-01-01",
        sex: "male",
        isPublic: false,
        clubs: [],
      });

    expect(res.status).toBe(403);
  });

  it("viewer → 403 PATCH /:id with a swimmer field change", async () => {
    authAs(profileA);
    let call = 0;
    mockDbSelect.mockImplementation(() => {
      call++;
      if (call === 1) return requireUserSelect(profileA);
      if (call === 2) return requireHouseholdMemberSelect(true, "viewer");
      return requireHouseholdSwimmerSelect(true);
    });

    const res = await request(app)
      .patch(`/swimmers/${SWIMMER_A_ID}`)
      .set("Authorization", "Bearer token")
      .send({ firstName: "Hacked" });

    expect(res.status).toBe(403);
  });

  it("viewer → 200 PATCH /:id { isPublic: false } (visibility allowed for any member)", async () => {
    authAs(profileA);
    let call = 0;
    mockDbSelect.mockImplementation(() => {
      call++;
      if (call === 1) return requireUserSelect(profileA);
      if (call === 2) return requireHouseholdMemberSelect(true, "viewer");
      if (call === 3) return requireHouseholdSwimmerSelect(true);
      if (call === 4) return swimmerSelect(baseSwimmerRow);
      if (call === 5) return clubsSelect();
      return regsSelect();
    });

    mockDbTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        select: () => {
          const limit = vi.fn().mockResolvedValue([{ isPublic: false }]);
          const where = vi.fn().mockReturnValue({ limit });
          return { from: vi.fn().mockReturnValue({ where }) };
        },
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
        }),
        delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
        insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
      };
      return fn(tx);
    });

    const res = await request(app)
      .patch(`/swimmers/${SWIMMER_A_ID}`)
      .set("Authorization", "Bearer token")
      .send({ isPublic: false });

    expect(res.status).toBe(200);
  });

  it("manager → 201 POST /swimmers with isPublic: false", async () => {
    authAs(profileA);
    const createdSwimmer = { ...baseSwimmerRow, id: SWIMMER_B_ID };
    let call = 0;
    mockDbSelect.mockImplementation(() => {
      call++;
      if (call === 1) return requireUserSelect(profileA);
      if (call === 2) return requireHouseholdMemberSelect(true, "manager");
      if (call === 3) return swimmerSelect(createdSwimmer);
      if (call === 4) return clubsSelect();
      return regsSelect();
    });

    mockDbTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([createdSwimmer]),
          }),
        }),
      };
      return fn(tx);
    });

    const res = await request(app)
      .post("/swimmers")
      .set("Authorization", "Bearer token")
      .send({
        firstName: "Bob",
        lastName: "Jones",
        birthDate: "2012-01-01",
        sex: "male",
        isPublic: false,
        clubs: [],
      });

    expect(res.status).toBe(201);
  });

  it("manager → 403 POST /swimmers with isPublic: true", async () => {
    authAs(profileA);
    let call = 0;
    mockDbSelect.mockImplementation(() => {
      call++;
      if (call === 1) return requireUserSelect(profileA);
      return requireHouseholdMemberSelect(true, "manager");
    });

    const res = await request(app)
      .post("/swimmers")
      .set("Authorization", "Bearer token")
      .send({
        firstName: "Bob",
        lastName: "Jones",
        birthDate: "2012-01-01",
        sex: "male",
        isPublic: true,
        clubs: [],
      });

    expect(res.status).toBe(403);
  });

  it("manager → 403 DELETE /:id", async () => {
    authAs(profileA);
    let call = 0;
    mockDbSelect.mockImplementation(() => {
      call++;
      if (call === 1) return requireUserSelect(profileA);
      if (call === 2) return requireHouseholdMemberSelect(true, "manager");
      return requireHouseholdSwimmerSelect(true);
    });

    const res = await request(app)
      .delete(`/swimmers/${SWIMMER_A_ID}`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(403);
  });

  it("owner → 200 PATCH /:id { isPublic: true }", async () => {
    authAs(profileA);
    const updatedSwimmer = { ...baseSwimmerRow, isPublic: true, publicConsentAt: now, publicConsentBy: PROFILE_A_ID };
    let call = 0;
    mockDbSelect.mockImplementation(() => {
      call++;
      if (call === 1) return requireUserSelect(profileA);
      if (call === 2) return requireHouseholdMemberSelect(true, "owner");
      if (call === 3) return requireHouseholdSwimmerSelect(true);
      if (call === 4) return swimmerSelect(updatedSwimmer);
      if (call === 5) return clubsSelect();
      return regsSelect();
    });

    mockDbTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        select: () => {
          const limit = vi.fn().mockResolvedValue([{ isPublic: false }]);
          const where = vi.fn().mockReturnValue({ limit });
          return { from: vi.fn().mockReturnValue({ where }) };
        },
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
        }),
        delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
        insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
      };
      return fn(tx);
    });

    const res = await request(app)
      .patch(`/swimmers/${SWIMMER_A_ID}`)
      .set("Authorization", "Bearer token")
      .send({ isPublic: true });

    expect(res.status).toBe(200);
    expect(res.body.isPublic).toBe(true);
  });

  it("owner → 204 DELETE /:id", async () => {
    authAs(profileA);
    let call = 0;
    mockDbSelect.mockImplementation(() => {
      call++;
      if (call === 1) return requireUserSelect(profileA);
      if (call === 2) return requireHouseholdMemberSelect(true, "owner");
      return requireHouseholdSwimmerSelect(true);
    });

    mockDbUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    });

    const res = await request(app)
      .delete(`/swimmers/${SWIMMER_A_ID}`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(204);
  });
});

// ── PUT /swimmers/:id/registrations/:league ───────────────────────────────────

describe("PUT /swimmers/:id/registrations/:league", () => {
  it("returns 200 and inserts a new registration when none exists", async () => {
    authAs(profileA);
    let call = 0;
    mockDbSelect.mockImplementation(() => {
      call++;
      if (call === 1) return requireUserSelect(profileA);
      if (call === 2) return requireHouseholdMemberSelect(true);
      if (call === 3) return requireHouseholdSwimmerSelect(true);
      return regCheckSelect(null);
    });
    mockDbInsert.mockReturnValue({ values: vi.fn().mockResolvedValue([]) });

    const res = await request(app)
      .put(`/swimmers/${SWIMMER_A_ID}/registrations/club`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    expect(mockDbInsert).toHaveBeenCalledOnce();
  });

  it("returns 200 and updates (no insert) when re-activating a withdrawn row", async () => {
    authAs(profileA);
    const REG_ID = "reg00000-0000-4000-8000-000000000001";
    let call = 0;
    mockDbSelect.mockImplementation(() => {
      call++;
      if (call === 1) return requireUserSelect(profileA);
      if (call === 2) return requireHouseholdMemberSelect(true);
      if (call === 3) return requireHouseholdSwimmerSelect(true);
      return regCheckSelect({ id: REG_ID, withdrawnAt: new Date("2026-08-01T00:00:00Z") });
    });
    mockDbUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    });

    const res = await request(app)
      .put(`/swimmers/${SWIMMER_A_ID}/registrations/club`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    expect(mockDbInsert).not.toHaveBeenCalled();
    expect(mockDbUpdate).toHaveBeenCalledOnce();
  });

  it("returns 200 without any write when already active (idempotent)", async () => {
    authAs(profileA);
    let call = 0;
    mockDbSelect.mockImplementation(() => {
      call++;
      if (call === 1) return requireUserSelect(profileA);
      if (call === 2) return requireHouseholdMemberSelect(true);
      if (call === 3) return requireHouseholdSwimmerSelect(true);
      return regCheckSelect({ id: "existing-reg-id", withdrawnAt: null });
    });

    const res = await request(app)
      .put(`/swimmers/${SWIMMER_A_ID}/registrations/club`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(200);
    expect(mockDbInsert).not.toHaveBeenCalled();
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it("returns 422 for an unrecognised league value", async () => {
    authAs(profileA);
    mockDbSelect.mockReturnValue(requireUserSelect(profileA));

    const res = await request(app)
      .put(`/swimmers/${SWIMMER_A_ID}/registrations/not_a_league`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(422);
  });
});

// ── DELETE /swimmers/:id/registrations/:league ────────────────────────────────

describe("DELETE /swimmers/:id/registrations/:league", () => {
  it("returns 204 and sets withdrawnAt when registered", async () => {
    authAs(profileA);
    const REG_ID = "reg00000-0000-4000-8000-000000000001";
    let call = 0;
    mockDbSelect.mockImplementation(() => {
      call++;
      if (call === 1) return requireUserSelect(profileA);
      if (call === 2) return requireHouseholdMemberSelect(true);
      if (call === 3) return requireHouseholdSwimmerSelect(true);
      return regCheckSelect({ id: REG_ID, withdrawnAt: null });
    });
    mockDbUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
    });

    const res = await request(app)
      .delete(`/swimmers/${SWIMMER_A_ID}/registrations/club`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(204);
    expect(mockDbUpdate).toHaveBeenCalledOnce();
  });

  it("returns 404 when not registered for the current season", async () => {
    authAs(profileA);
    let call = 0;
    mockDbSelect.mockImplementation(() => {
      call++;
      if (call === 1) return requireUserSelect(profileA);
      if (call === 2) return requireHouseholdMemberSelect(true);
      if (call === 3) return requireHouseholdSwimmerSelect(true);
      return regCheckSelect(null);
    });

    const res = await request(app)
      .delete(`/swimmers/${SWIMMER_A_ID}/registrations/club`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "Not registered" });
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });
});

// ── DELETE /swimmers/:id — archive atomicity ──────────────────────────────────

describe("DELETE /swimmers/:id archive", () => {
  function archiveMocks() {
    authAs(profileA);
    let call = 0;
    mockDbSelect.mockImplementation(() => {
      call++;
      if (call === 1) return requireUserSelect(profileA);
      if (call === 2) return requireHouseholdMemberSelect(true); // role = "owner"
      return requireHouseholdSwimmerSelect(true);
    });
  }

  it("archives swimmer inside a transaction → 204", async () => {
    archiveMocks();
    mockDbTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
        insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
      };
      return fn(tx);
    });

    const res = await request(app)
      .delete(`/swimmers/${SWIMMER_A_ID}`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(204);
    expect(mockDbTransaction).toHaveBeenCalledOnce();
    // Direct db.update must not be called — the route must go through db.transaction.
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });

  it("if audit log insert fails inside the transaction → 500; preceding update rolls back", async () => {
    // In production, db.transaction() issues a single Postgres transaction.
    // If the audit insert throws, Postgres rolls back the preceding update atomically.
    // This test verifies the error propagates through the transaction boundary.
    archiveMocks();
    const txUpdate = vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) });
    mockDbTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        update: txUpdate,
        insert: vi.fn().mockReturnValue({ values: vi.fn().mockRejectedValue(new Error("constraint violation")) }),
      };
      return fn(tx);
    });

    const res = await request(app)
      .delete(`/swimmers/${SWIMMER_A_ID}`)
      .set("Authorization", "Bearer token");

    expect(res.status).toBe(500);
    // The update was reached but the transaction as a whole failed.
    expect(txUpdate).toHaveBeenCalledOnce();
    expect(mockDbUpdate).not.toHaveBeenCalled();
  });
});

// ── PATCH /coach/swimmers/:id ─────────────────────────────────────────────────

describe("PATCH /coach/swimmers/:id — recommendedBreathingPattern", () => {
  beforeEach(() => {
    authAs(profileCoach);
    vi.resetAllMocks();
    authAs(profileCoach);
  });

  it("returns 200 and updates recommendedBreathingPattern", async () => {
    mockDbSelect.mockReturnValueOnce(requireUserSelect(profileCoach));

    const returningMock = vi.fn().mockResolvedValue([{ id: SWIMMER_A_ID }]);
    const whereMock = vi.fn().mockReturnValue({ returning: returningMock });
    const setMock = vi.fn().mockReturnValue({ where: whereMock });
    mockDbUpdate.mockReturnValueOnce({ set: setMock });

    const res = await request(app)
      .patch(`/coach/swimmers/${SWIMMER_A_ID}`)
      .set("Authorization", "Bearer token")
      .send({ recommendedBreathingPattern: "every_3" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("returns 404 for unknown or archived swimmer", async () => {
    mockDbSelect.mockReturnValueOnce(requireUserSelect(profileCoach));

    const returningMock = vi.fn().mockResolvedValue([]);
    const whereMock = vi.fn().mockReturnValue({ returning: returningMock });
    const setMock = vi.fn().mockReturnValue({ where: whereMock });
    mockDbUpdate.mockReturnValueOnce({ set: setMock });

    const res = await request(app)
      .patch(`/coach/swimmers/${SWIMMER_A_ID}`)
      .set("Authorization", "Bearer token")
      .send({ recommendedBreathingPattern: "every_3" });

    expect(res.status).toBe(404);
  });

  it("returns 422 for invalid recommendedBreathingPattern value", async () => {
    mockDbSelect.mockReturnValueOnce(requireUserSelect(profileCoach));

    const res = await request(app)
      .patch(`/coach/swimmers/${SWIMMER_A_ID}`)
      .set("Authorization", "Bearer token")
      .send({ recommendedBreathingPattern: "not_valid" });

    expect(res.status).toBe(422);
  });
});
