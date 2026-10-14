import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import pino from "pino";

const { mockGetUser, mockSignUp, mockDbWhere, mockDbReturning } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockSignUp: vi.fn(),
  mockDbWhere: vi.fn(),
  mockDbReturning: vi.fn(),
}));

vi.mock("../lib/supabase", () => ({
  supabase: { auth: { getUser: mockGetUser, signUp: mockSignUp } },
}));

vi.mock("../db/client", () => ({
  db: {
    select: () => ({ from: () => ({ where: mockDbWhere }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: mockDbReturning }) }) }),
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

const validSignUpBody = {
  fullName: "Jane Parent",
  email: "jane@example.com",
  password: "securepass1",
  birthDate: ADULT_BIRTH_DATE,
  acceptedTerms: true as const,
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

  it("returns 201 for a user turning 18 today", async () => {
    mockSignUp.mockResolvedValue({
      data: { user: { id: "00000000-0000-0000-0000-000000000002" }, session: null },
      error: null,
    });
    mockDbReturning.mockResolvedValue([baseProfile]);
    const res = await request(app)
      .post("/auth/signup")
      .send({ ...validSignUpBody, birthDate: TURNING_18_TODAY_BIRTH_DATE });
    expect(res.status).toBe(201);
  });

  it("always passes emailRedirectTo pointing to /auth/confirm? for a normal signup", async () => {
    const userId = "00000000-0000-0000-0000-000000000003";
    mockSignUp.mockResolvedValue({
      data: { user: { id: userId }, session: null },
      error: null,
    });
    mockDbReturning.mockResolvedValue([baseProfile]);

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
    expect(mockDbReturning).toHaveBeenCalled();
  });

  it("passes emailRedirectTo with returnTo encoded for an invite signup", async () => {
    const userId = "00000000-0000-0000-0000-000000000005";
    mockSignUp.mockResolvedValue({
      data: { user: { id: userId }, session: null },
      error: null,
    });
    mockDbReturning.mockResolvedValue([baseProfile]);

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
    mockDbReturning.mockResolvedValue([]);
    const res = await request(app).post("/auth/signup").send(validSignUpBody);
    expect(res.status).toBe(500);
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

  it("returns 403 when profile is disabled", async () => {
    mockGetUser.mockResolvedValue(validUser);
    mockDbWhere.mockResolvedValue([{ ...baseProfile, disabledAt: new Date() }]);
    const res = await request(app).get("/me").set("Authorization", "Bearer token");
    expect(res.status).toBe(403);
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
