import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import pino from "pino";

const {
  mockGetUser,
  mockSignUp,
  mockDbWhere,
  mockDbReturning,
  mockTxReturning,
  mockTxSelectHouseholdLimit,
  mockTxInsertAcceptance,
  mockTxInsertAudit,
} = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockSignUp: vi.fn(),
  mockDbWhere: vi.fn(),
  mockDbReturning: vi.fn(),
  // ADR 036 Phase 8 Part B Stop 3: signup now runs profile update +
  // policy acceptance inserts inside one transaction. These mocks cover
  // the drizzle shapes the route uses on the tx handle.
  mockTxReturning: vi.fn(),
  mockTxSelectHouseholdLimit: vi.fn(),
  mockTxInsertAcceptance: vi.fn(),
  mockTxInsertAudit: vi.fn(),
}));

vi.mock("../lib/supabase", () => ({
  supabase: { auth: { getUser: mockGetUser, signUp: mockSignUp } },
}));

vi.mock("../db/client", () => ({
  db: {
    select: () => ({ from: () => ({ where: mockDbWhere }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: mockDbReturning }) }) }),
    transaction: async (
      run: (tx: {
        update: () => {
          set: () => { where: () => { returning: () => Promise<unknown> } };
        };
        select: () => {
          from: () => { where: () => { limit: () => Promise<unknown> } };
        };
        insert: (table: unknown) => {
          values: (values: unknown) => {
            returning: () => Promise<unknown>;
          } | Promise<unknown>;
        };
      }) => Promise<unknown>,
    ) => {
      const tx = {
        update: () => ({
          set: () => ({ where: () => ({ returning: mockTxReturning }) }),
        }),
        select: () => ({
          from: () => ({
            where: () => ({ limit: mockTxSelectHouseholdLimit }),
          }),
        }),
        insert: (table: unknown) => {
          // schema.userPolicyAcceptances uses a `.returning()`; audit log
          // does not. Discriminate by presence of the `.returning` call in
          // the awaiter. The simplest shape: always return an object with
          // both `.returning` (for acceptance) and a thenable for audit.
          const values = (vals: unknown) => {
            void vals;
            // Audit log insert uses `await tx.insert(x).values(y)`; shape
            // supports both `await ... .values(y)` and
            // `await ... .values(y).returning()` by returning a
            // thenable that also carries `.returning()`.
            const acceptanceReturning = mockTxInsertAcceptance;
            const auditResolver = mockTxInsertAudit;
            // Return a thenable that awaits to the audit resolver, plus
            // a `.returning()` for the acceptance insert.
            const thenable: {
              then: (
                resolve: (value: unknown) => void,
                reject: (err: unknown) => void,
              ) => void;
              returning: () => Promise<unknown>;
            } = {
              then: (resolve, reject) => {
                Promise.resolve(auditResolver()).then(resolve, reject);
              },
              returning: () => acceptanceReturning(),
            };
            // Silence unused-table warning (schema check path).
            void table;
            return thenable;
          };
          return { values };
        },
      };
      return run(tx as never);
    },
  },
}));

import { createApp } from "../app";

const logger = pino({ level: "silent" });
const app = createApp(logger);

const baseProfile = {
  id: "00000000-0000-0000-0000-000000000001",
  role: "parent" as const,
  fullName: "Test User",
  phone: null,
  ageAttestedAt: new Date(),
  disabledAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const validUser = {
  data: { user: { id: baseProfile.id, email: "test@example.com" } },
  error: null,
};

beforeEach(() => {
  vi.resetAllMocks();
});

// Fake "today" in LA: 2025-06-15. Under-18 cutoff: born on or after 2007-06-16.
const FAKE_NOW = new Date("2025-06-15T12:00:00Z");
const ADULT_BIRTH_DATE = "1990-01-01";
const UNDER_18_BIRTH_DATE = "2007-06-16"; // turns 18 tomorrow
const TURNING_18_TODAY_BIRTH_DATE = "2007-06-15";

// ADR 036 Phase 8 Part B Stop 3: signup now requires the three policy
// version constants the server page renders. Using the current constants
// via @swim-app/shared keeps the fixture in lockstep with a bump — a
// future version change means updating the constants file and rerunning.
import {
  PAYMENTS_REFUND_VERSION,
  PRIVACY_VERSION,
  TERMS_VERSION,
} from "@swim-app/shared";

const validSignUpBody = {
  fullName: "Jane Parent",
  email: "jane@example.com",
  password: "securepass1",
  birthDate: ADULT_BIRTH_DATE,
  acceptedTerms: true as const,
  acceptedPolicyVersions: {
    terms: TERMS_VERSION,
    privacy: PRIVACY_VERSION,
    payments_refund: PAYMENTS_REFUND_VERSION,
  },
};

describe("requireUser middleware", () => {
  it("returns 401 with no Authorization header", async () => {
    const res = await request(app).get("/me");
    expect(res.status).toBe(401);
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it("returns 401 when getUser returns an error (revoked / invalid token)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: new Error("invalid token") });
    const res = await request(app).get("/me").set("Authorization", "Bearer bad-token");
    expect(res.status).toBe(401);
  });

  it("returns 401 when getUser returns no user and no error", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await request(app).get("/me").set("Authorization", "Bearer revoked-token");
    expect(res.status).toBe(401);
  });

  it("returns 401 when getUser returns a user with no email", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: baseProfile.id, email: undefined } }, error: null });
    const res = await request(app).get("/me").set("Authorization", "Bearer no-email-token");
    expect(res.status).toBe(401);
  });

  it("returns 503 when getUser throws (auth service down)", async () => {
    mockGetUser.mockRejectedValue(new Error("network error"));
    const res = await request(app).get("/me").set("Authorization", "Bearer any-token");
    expect(res.status).toBe(503);
  });
});

describe("POST /auth/signup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FAKE_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 422 when acceptedTerms is false", async () => {
    const res = await request(app)
      .post("/auth/signup")
      .send({ ...validSignUpBody, acceptedTerms: false });
    expect(res.status).toBe(422);
  });

  it("returns 422 when body contains unknown field role", async () => {
    const res = await request(app)
      .post("/auth/signup")
      .send({ ...validSignUpBody, role: "coach" });
    expect(res.status).toBe(422);
  });

  it("returns 422 for an impossible date like 2026-02-31", async () => {
    const res = await request(app)
      .post("/auth/signup")
      .send({ ...validSignUpBody, birthDate: "2026-02-31" });
    expect(res.status).toBe(422);
  });

  it("returns 403 for an under-18 user and never calls signUp", async () => {
    const res = await request(app)
      .post("/auth/signup")
      .send({ ...validSignUpBody, birthDate: UNDER_18_BIRTH_DATE });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Ask a parent or guardian to create an account" });
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  // Helper: wires the mocks for a successful signup — Supabase returns a
  // user, the profile tx update returns the profile row, the household
  // lookup finds a membership, and the acceptance + audit inserts resolve.
  function setupSuccessfulSignup(userId: string): void {
    mockSignUp.mockResolvedValue({
      data: { user: { id: userId }, session: null },
      error: null,
    });
    mockTxReturning.mockResolvedValue([baseProfile]);
    mockTxSelectHouseholdLimit.mockResolvedValue([
      { householdId: "00000000-0000-0000-0000-00000000aaaa" },
    ]);
    mockTxInsertAcceptance.mockResolvedValue([{ id: "00000000-0000-0000-0000-00000000bbbb" }]);
    mockTxInsertAudit.mockResolvedValue(undefined);
  }

  it("returns 201 for a user turning 18 today", async () => {
    setupSuccessfulSignup("00000000-0000-0000-0000-000000000002");
    const res = await request(app)
      .post("/auth/signup")
      .send({ ...validSignUpBody, birthDate: TURNING_18_TODAY_BIRTH_DATE });
    expect(res.status).toBe(201);
  });

  it("always passes emailRedirectTo pointing to /auth/confirm? for a normal signup", async () => {
    const userId = "00000000-0000-0000-0000-000000000003";
    setupSuccessfulSignup(userId);

    const res = await request(app).post("/auth/signup").send(validSignUpBody);

    expect(res.status).toBe(201);
    expect(mockSignUp).toHaveBeenCalledWith({
      email: validSignUpBody.email,
      password: validSignUpBody.password,
      options: {
        data: { full_name: validSignUpBody.fullName },
        emailRedirectTo: "http://localhost:3000/auth/confirm?",
      },
    });
    expect(mockTxReturning).toHaveBeenCalled();
  });

  it("passes emailRedirectTo with returnTo encoded for an invite signup", async () => {
    const userId = "00000000-0000-0000-0000-000000000005";
    setupSuccessfulSignup(userId);

    const res = await request(app)
      .post("/auth/signup")
      .send({ ...validSignUpBody, returnTo: "/invite/abc123" });

    expect(res.status).toBe(201);
    expect(mockSignUp).toHaveBeenCalledWith({
      email: validSignUpBody.email,
      password: validSignUpBody.password,
      options: {
        data: { full_name: validSignUpBody.fullName },
        emailRedirectTo: "http://localhost:3000/auth/confirm?returnTo=%2Finvite%2Fabc123",
      },
    });
  });

  it("returns 500 if profile row is missing after signUp", async () => {
    const userId = "00000000-0000-0000-0000-000000000004";
    mockSignUp.mockResolvedValue({
      data: { user: { id: userId }, session: null },
      error: null,
    });
    mockTxReturning.mockResolvedValue([]);
    const res = await request(app).post("/auth/signup").send(validSignUpBody);
    expect(res.status).toBe(500);
  });

  // ADR 036 Phase 8 Part B Stop 3: stale policy versions short-circuit
  // before Supabase auth is even touched, so no user is ever created
  // with an un-recorded acceptance. Uses a dedicated email so the
  // shared `authEmailLimiter` counter for jane@example.com doesn't
  // reach 5 and short-circuit with 429 across the earlier cases.
  it("returns 422 stale_policy_versions when any submitted version is behind", async () => {
    const res = await request(app)
      .post("/auth/signup")
      .send({
        ...validSignUpBody,
        email: "stale-policy@example.com",
        acceptedPolicyVersions: {
          terms: "1999-01-01",
          privacy: PRIVACY_VERSION,
          payments_refund: PAYMENTS_REFUND_VERSION,
        },
      });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("stale_policy_versions");
    expect(res.body.missing).toEqual([
      expect.objectContaining({ policySlug: "terms", currentVersion: TERMS_VERSION }),
    ]);
    expect(mockSignUp).not.toHaveBeenCalled();
  });
});

describe("GET /me", () => {
  it("returns 401 with no Authorization header", async () => {
    const res = await request(app).get("/me");
    expect(res.status).toBe(401);
  });

  it("returns 401 with an invalid token", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: new Error("invalid") });
    const res = await request(app).get("/me").set("Authorization", "Bearer bad-token");
    expect(res.status).toBe(401);
  });

  it("returns 403 when no profile row exists", async () => {
    mockGetUser.mockResolvedValue(validUser);
    mockDbWhere.mockResolvedValue([]);
    const res = await request(app).get("/me").set("Authorization", "Bearer token");
    expect(res.status).toBe(403);
  });

  it("returns 401 when profile is disabled (ADR 034 stale-token guard)", async () => {
    // Supabase considered the access token valid (getUser returned a user),
    // but the profile has been scrubbed by the deletion flow. 401 forces
    // clients to treat the session as gone rather than retry with the same
    // token, which would succeed against Supabase until the auth user is
    // hard-deleted in the post-commit task.
    mockGetUser.mockResolvedValue(validUser);
    mockDbWhere.mockResolvedValue([{ ...baseProfile, disabledAt: new Date() }]);
    const res = await request(app).get("/me").set("Authorization", "Bearer token");
    expect(res.status).toBe(401);
  });

  it("a still-valid token for a deleted profile gets 401 (ADR 034)", async () => {
    // Dedicated regression for the scenario in docs/plans/account-deletion.md
    // decision 1a. The access token is still cryptographically valid in
    // Supabase — the post-commit auth.admin.deleteUser call has not run,
    // or is retrying after a transient failure — but the deletion
    // transaction has committed, which means the profile row carries
    // disabled_at. requireUser must reject the request at the DB-side
    // check, not wait for Supabase to catch up.
    const stillValidToken = "token-whose-exp-is-still-in-the-future";
    mockGetUser.mockResolvedValue(validUser);
    mockDbWhere.mockResolvedValue([{ ...baseProfile, disabledAt: new Date() }]);

    const res = await request(app).get("/me").set("Authorization", `Bearer ${stillValidToken}`);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Unauthorized" });
    // Supabase was consulted exactly once; no fallback or retry path
    // lets the stale token sneak through requireUser.
    expect(mockGetUser).toHaveBeenCalledTimes(1);
    expect(mockGetUser).toHaveBeenCalledWith(stillValidToken);
  });

  it("returns 403 when age_attested_at is null", async () => {
    mockGetUser.mockResolvedValue(validUser);
    mockDbWhere.mockResolvedValue([{ ...baseProfile, ageAttestedAt: null }]);
    const res = await request(app).get("/me").set("Authorization", "Bearer token");
    expect(res.status).toBe(403);
  });

  it("returns 200 with email, fullName, phone, and role for a valid parent", async () => {
    mockGetUser.mockResolvedValue(validUser);
    mockDbWhere.mockResolvedValue([baseProfile]);
    const res = await request(app).get("/me").set("Authorization", "Bearer token");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      email: "test@example.com",
      fullName: "Test User",
      phone: null,
      role: "parent",
    });
  });
});

describe("GET /coach/ping", () => {
  it("returns 403 for a parent", async () => {
    mockGetUser.mockResolvedValue(validUser);
    mockDbWhere.mockResolvedValue([{ ...baseProfile, role: "parent" }]);
    const res = await request(app).get("/coach/ping").set("Authorization", "Bearer token");
    expect(res.status).toBe(403);
  });

  it("returns 200 for a coach", async () => {
    mockGetUser.mockResolvedValue(validUser);
    mockDbWhere.mockResolvedValue([{ ...baseProfile, role: "coach" }]);
    const res = await request(app).get("/coach/ping").set("Authorization", "Bearer token");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ pong: true });
  });
});

describe("PATCH /me", () => {
  it("returns 401 with no Authorization header", async () => {
    const res = await request(app).patch("/me").send({ fullName: "New Name" });
    expect(res.status).toBe(401);
  });

  it("returns 401 with no token even when the body would fail validation", async () => {
    const res = await request(app).patch("/me").send({ role: "coach" });
    expect(res.status).toBe(401);
  });

  it("returns 422 and does not update when body contains unknown field role", async () => {
    mockGetUser.mockResolvedValue(validUser);
    mockDbWhere.mockResolvedValue([baseProfile]);
    const res = await request(app)
      .patch("/me")
      .set("Authorization", "Bearer token")
      .send({ role: "coach" });
    expect(res.status).toBe(422);
    expect(mockDbReturning).not.toHaveBeenCalled();
  });

  it("returns 422 when body is empty", async () => {
    mockGetUser.mockResolvedValue(validUser);
    mockDbWhere.mockResolvedValue([baseProfile]);
    const res = await request(app)
      .patch("/me")
      .set("Authorization", "Bearer token")
      .send({});
    expect(res.status).toBe(422);
    expect(mockDbReturning).not.toHaveBeenCalled();
  });

  it("returns 200 with updated name trimmed", async () => {
    const updated = { ...baseProfile, fullName: "New Name" };
    mockGetUser.mockResolvedValue(validUser);
    mockDbWhere.mockResolvedValue([baseProfile]);
    mockDbReturning.mockResolvedValue([updated]);
    const res = await request(app)
      .patch("/me")
      .set("Authorization", "Bearer token")
      .send({ fullName: "  New Name  " });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ email: "test@example.com", fullName: "New Name", phone: null, role: "parent" });
  });
});
