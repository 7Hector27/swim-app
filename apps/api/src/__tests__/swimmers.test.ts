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
 * Returns a mock chain for requireGuardian:
 * db.select().from().innerJoin().where().limit() → [{ swimmerId }] or [].
 */
function requireGuardianSelect(found: boolean) {
  const rows = found ? [{ swimmerId: SWIMMER_A_ID }] : [];
  const limit = vi.fn().mockResolvedValue(rows);
  const where = vi.fn().mockReturnValue({ limit });
  const innerJoin = vi.fn().mockReturnValue({ where });
  return { from: vi.fn().mockReturnValue({ where, innerJoin }) };
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
    // requireUser is the only DB call — validate() rejects the non-UUID before requireGuardian
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
    // Profile B is authenticated but is not a guardian of swimmer A
    authAs(profileB);
    let call = 0;
    mockDbSelect.mockImplementation(() => {
      call++;
      if (call === 1) return requireUserSelect(profileB);
      return requireGuardianSelect(false);
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
    // requireGuardian filters archived_at IS NULL — returns empty → 404
    authAs(profileA);
    let call = 0;
    mockDbSelect.mockImplementation(() => {
      call++;
      if (call === 1) return requireUserSelect(profileA);
      return requireGuardianSelect(false);
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
      if (call === 2) {
        // guardians query returns the swimmer id
        const where = vi.fn().mockResolvedValue([{ swimmerId: SWIMMER_A_ID }]);
        return { from: vi.fn().mockReturnValue({ where }) };
      }
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

describe("POST /swimmers atomicity", () => {
  // Cannot be proven with a mocked db.transaction — the mock doesn't implement
  // real rollback semantics. Needs an integration test against local Supabase.
  it.todo(
    "rolls back swimmer + guardian rows when club insert fails (FK violation) — integration test needed",
  );
});

// ── Consent fields ────────────────────────────────────────────────────────────

describe("consent fields", () => {
  it("rejects publicConsentAt in POST body (strict schema → 422)", async () => {
    authAs(profileA);
    mockDbSelect.mockReturnValue(requireUserSelect(profileA));

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
      if (call === 2) return requireGuardianSelect(true);
      if (call === 3) return swimmerSelect(updatedSwimmer);
      return clubsSelect();
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
      if (call === 2) return requireGuardianSelect(true);
      if (call === 3) return swimmerSelect(baseSwimmerRow);
      return clubsSelect();
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
      if (call === 2) return requireGuardianSelect(true);
      if (call === 3) return swimmerSelect(baseSwimmerRow);
      return clubsSelect();
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

describe("ParentSwimmerSchema", () => {
  // Verifying the schema against a real DB row requires an integration test —
  // mocked data may not exactly match what Postgres + Drizzle actually return
  // (e.g. date vs. string types, nullable field shapes). Needs local Supabase.
  it.todo("real DB row parses with ParentSwimmerSchema — integration test needed");
});

// ── Async error handling ──────────────────────────────────────────────────────

describe("async error handling", () => {
  it("returns 500 through errorHandler when a DB call throws", async () => {
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
  it("returns active swimmers with clubs for the caller", async () => {
    authAs(profileA);
    let call = 0;
    mockDbSelect.mockImplementation(() => {
      call++;
      if (call === 1) return requireUserSelect(profileA);
      if (call === 2) {
        // guardians
        const where = vi.fn().mockResolvedValue([{ swimmerId: SWIMMER_A_ID }]);
        return { from: vi.fn().mockReturnValue({ where }) };
      }
      if (call === 3) {
        // active swimmers
        const where = vi.fn().mockResolvedValue([baseSwimmerRow]);
        return { from: vi.fn().mockReturnValue({ where }) };
      }
      // swimmer_clubs
      const where = vi.fn().mockResolvedValue([baseClubRow]);
      return { from: vi.fn().mockReturnValue({ where }) };
    });

    const res = await request(app).get("/swimmers/me").set("Authorization", "Bearer token");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(SWIMMER_A_ID);
    expect(res.body[0].clubs).toHaveLength(1);
  });

  it("returns empty array when caller has no swimmers", async () => {
    authAs(profileA);
    let call = 0;
    mockDbSelect.mockImplementation(() => {
      call++;
      if (call === 1) return requireUserSelect(profileA);
      // guardians returns empty
      const where = vi.fn().mockResolvedValue([]);
      return { from: vi.fn().mockReturnValue({ where }) };
    });

    const res = await request(app).get("/swimmers/me").set("Authorization", "Bearer token");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// ── POST /swimmers — guardian row uses caller's profile id ───────────────────

describe("POST /swimmers", () => {
  it("inserts guardian row for the authenticated caller, not another profile", async () => {
    authAs(profileB);
    mockDbSelect.mockReturnValue(requireUserSelect(profileB));

    const createdSwimmer = { ...baseSwimmerRow, id: SWIMMER_B_ID };

    mockDbTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const insertedGuardians: unknown[] = [];
      const tx = {
        insert: vi.fn().mockImplementation(() => ({
          values: vi.fn().mockImplementation((vals: unknown) => {
            // Capture all inserts; guardians have profileId + swimmerId shape
            if (
              vals !== null &&
              typeof vals === "object" &&
              "profileId" in (vals as object)
            ) {
              insertedGuardians.push(vals);
            }
            return { returning: vi.fn().mockResolvedValue([createdSwimmer]) };
          }),
        })),
      };
      await fn(tx);
      expect(insertedGuardians[0]).toMatchObject({ profileId: PROFILE_B_ID });
      return createdSwimmer;
    });

    let postCall = 0;
    const origImpl = mockDbSelect.getMockImplementation()!;
    mockDbSelect.mockImplementation(() => {
      postCall++;
      if (postCall === 1) return origImpl();
      if (postCall === 2) return swimmerSelect(createdSwimmer);
      return clubsSelect();
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
