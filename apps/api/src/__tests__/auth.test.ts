import { vi, describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import pino from "pino";

const { mockGetClaims, mockDbWhere, mockDbReturning } = vi.hoisted(() => ({
  mockGetClaims: vi.fn(),
  mockDbWhere: vi.fn(),
  mockDbReturning: vi.fn(),
}));

vi.mock("../lib/supabase", () => ({
  supabase: { auth: { getClaims: mockGetClaims } },
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

const validClaims = {
  data: { claims: { sub: baseProfile.id }, header: {}, signature: new Uint8Array() },
  error: null,
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe("GET /me", () => {
  it("returns 401 with no Authorization header", async () => {
    const res = await request(app).get("/me");
    expect(res.status).toBe(401);
  });

  it("returns 401 with an invalid token", async () => {
    mockGetClaims.mockResolvedValue({ data: null, error: new Error("invalid") });
    const res = await request(app).get("/me").set("Authorization", "Bearer bad-token");
    expect(res.status).toBe(401);
  });

  it("returns 403 when no profile row exists", async () => {
    mockGetClaims.mockResolvedValue(validClaims);
    mockDbWhere.mockResolvedValue([]);
    const res = await request(app).get("/me").set("Authorization", "Bearer token");
    expect(res.status).toBe(403);
  });

  it("returns 403 when profile is disabled", async () => {
    mockGetClaims.mockResolvedValue(validClaims);
    mockDbWhere.mockResolvedValue([{ ...baseProfile, disabledAt: new Date() }]);
    const res = await request(app).get("/me").set("Authorization", "Bearer token");
    expect(res.status).toBe(403);
  });

  it("returns 403 when age_attested_at is null", async () => {
    mockGetClaims.mockResolvedValue(validClaims);
    mockDbWhere.mockResolvedValue([{ ...baseProfile, ageAttestedAt: null }]);
    const res = await request(app).get("/me").set("Authorization", "Bearer token");
    expect(res.status).toBe(403);
  });

  it("returns 200 with only fullName, phone, and role for a valid parent", async () => {
    mockGetClaims.mockResolvedValue(validClaims);
    mockDbWhere.mockResolvedValue([baseProfile]);
    const res = await request(app).get("/me").set("Authorization", "Bearer token");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ fullName: "Test User", phone: null, role: "parent" });
  });
});

describe("GET /coach/ping", () => {
  it("returns 403 for a parent", async () => {
    mockGetClaims.mockResolvedValue(validClaims);
    mockDbWhere.mockResolvedValue([{ ...baseProfile, role: "parent" }]);
    const res = await request(app).get("/coach/ping").set("Authorization", "Bearer token");
    expect(res.status).toBe(403);
  });

  it("returns 200 for a coach", async () => {
    mockGetClaims.mockResolvedValue(validClaims);
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
    mockGetClaims.mockResolvedValue(validClaims);
    mockDbWhere.mockResolvedValue([baseProfile]);
    const res = await request(app)
      .patch("/me")
      .set("Authorization", "Bearer token")
      .send({ role: "coach" });
    expect(res.status).toBe(422);
    expect(mockDbReturning).not.toHaveBeenCalled();
  });

  it("returns 422 when body is empty", async () => {
    mockGetClaims.mockResolvedValue(validClaims);
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
    mockGetClaims.mockResolvedValue(validClaims);
    mockDbWhere.mockResolvedValue([baseProfile]);
    mockDbReturning.mockResolvedValue([updated]);
    const res = await request(app)
      .patch("/me")
      .set("Authorization", "Bearer token")
      .send({ fullName: "  New Name  " });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ fullName: "New Name", phone: null, role: "parent" });
  });
});
