// Integration tests for the coach Google Calendar OAuth surface (phase 1).
// The google-auth-library + @googleapis/calendar wrapper is mocked at the
// module boundary so no real HTTP calls go to Google.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import pino from "pino";
import { eq } from "drizzle-orm";

// Google env vars must be present at `createApp` time so getEnv() parses the
// integration as configured. Set before any import of app.ts.
process.env["GOOGLE_OAUTH_CLIENT_ID"] = "test-client-id";
process.env["GOOGLE_OAUTH_CLIENT_SECRET"] = "test-client-secret";
process.env["GOOGLE_OAUTH_REDIRECT_URI"] = "http://localhost:3001/integrations/google/callback";
process.env["GOOGLE_TOKEN_ENCRYPTION_KEY"] = Buffer.alloc(32, 7).toString("base64");
process.env["GOOGLE_OAUTH_STATE_SECRET"] = "s".repeat(32);

// Mock the Google client wrapper. Tests set behavior per case via the
// exported `mockClient` object (populated below).
vi.mock("../../services/googleCalendarClient", () => ({
  CALENDAR_SCOPE: "https://www.googleapis.com/auth/calendar.app.created",
  getAuthorizeUrl: vi.fn(),
  exchangeCodeForTokens: vi.fn(),
  calendarExists: vi.fn(),
  createDedicatedCalendar: vi.fn(),
  revokeToken: vi.fn(),
}));

import { createApp } from "../../app";
import { coachAuditLog, coachCalendarIntegrations, profiles } from "../../db/schema";
import { __resetEnvCacheForTests } from "../../lib/env";
import { signState } from "../../lib/oauthState";
import * as googleClient from "../../services/googleCalendarClient";
import { adminDb, closeAdminDb, createTestUser, type TestUser } from "./helpers";

__resetEnvCacheForTests();

const logger = pino({ level: "silent" });
const app = createApp(logger);

const STATE_SECRET = "s".repeat(32);
const KEY = Buffer.alloc(32, 7).toString("base64");

let coach: TestUser;

async function makeCoach(userId: string): Promise<void> {
  await adminDb().update(profiles).set({ role: "coach" }).where(eq(profiles.id, userId));
}

async function clearCoachRows(coachId: string): Promise<void> {
  // Audit log has RESTRICT on coach_id → delete rows before clearing profile.
  await adminDb().delete(coachAuditLog).where(eq(coachAuditLog.coachId, coachId));
  // Calendar integration cascades on profile delete, but delete explicitly
  // so each test starts with a clean row.
  await adminDb()
    .delete(coachCalendarIntegrations)
    .where(eq(coachCalendarIntegrations.coachProfileId, coachId));
}

beforeAll(async () => {
  coach = await createTestUser("coach-google-cal-int");
  await makeCoach(coach.userId);
});

beforeEach(async () => {
  vi.mocked(googleClient.getAuthorizeUrl).mockReturnValue(
    "https://accounts.google.com/o/oauth2/v2/auth?mock=1",
  );
  vi.mocked(googleClient.exchangeCodeForTokens).mockResolvedValue({
    refreshToken: "refresh-token-value",
    accessToken: "access-token-value",
    email: "coach-google@example.com",
    scope: "https://www.googleapis.com/auth/calendar.app.created",
  });
  vi.mocked(googleClient.calendarExists).mockResolvedValue({ exists: true });
  vi.mocked(googleClient.createDedicatedCalendar).mockResolvedValue({
    id: "mock-google-calendar-id",
  });
  vi.mocked(googleClient.revokeToken).mockResolvedValue(undefined);
});

afterEach(async () => {
  vi.clearAllMocks();
  await clearCoachRows(coach.userId);
});

afterAll(async () => {
  await clearCoachRows(coach.userId);
  await coach.cleanup();
  await closeAdminDb();
});

describe("GET /coach/calendar/status", () => {
  it("returns not_connected when no integration row exists", async () => {
    const res = await request(app)
      .get("/coach/calendar/status")
      .set("Authorization", `Bearer ${coach.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("not_connected");
    expect(res.body.connectedAccountEmail).toBeNull();
  });
});

describe("GET /integrations/google/start", () => {
  it("returns an authorize URL and does not create any DB rows", async () => {
    const res = await request(app)
      .get("/integrations/google/start")
      .set("Authorization", `Bearer ${coach.accessToken}`);
    expect(res.status).toBe(200);
    expect(typeof res.body.authorizeUrl).toBe("string");
    expect(res.body.authorizeUrl).toContain("accounts.google.com");

    const rows = await adminDb()
      .select()
      .from(coachCalendarIntegrations)
      .where(eq(coachCalendarIntegrations.coachProfileId, coach.userId));
    expect(rows).toHaveLength(0);
  });
});

describe("GET /integrations/google/callback — connect flow", () => {
  it("creates the integration row and writes a calendar_connected audit entry in one transaction", async () => {
    const state = signState(coach.userId, STATE_SECRET);
    const res = await request(app)
      .get("/integrations/google/callback")
      .query({ code: "auth-code-value", state });
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("/account");
    expect(res.headers.location).toContain("google=connected");

    const rows = await adminDb()
      .select()
      .from(coachCalendarIntegrations)
      .where(eq(coachCalendarIntegrations.coachProfileId, coach.userId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "active",
      googleAccountEmail: "coach-google@example.com",
      googleCalendarId: "mock-google-calendar-id",
      needsReconnectSince: null,
    });
    expect(rows[0]!.refreshTokenCiphertext.length).toBeGreaterThan(0);
    expect(rows[0]!.refreshTokenIv.length).toBe(12);
    expect(rows[0]!.refreshTokenTag.length).toBe(16);

    const audit = await adminDb()
      .select()
      .from(coachAuditLog)
      .where(eq(coachAuditLog.coachId, coach.userId));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "calendar_connected",
      actorId: coach.userId,
    });
  });

  it("creates a fresh dedicated calendar on first connect (calendars.insert called)", async () => {
    const state = signState(coach.userId, STATE_SECRET);
    await request(app)
      .get("/integrations/google/callback")
      .query({ code: "auth-code", state });
    expect(googleClient.createDedicatedCalendar).toHaveBeenCalledTimes(1);
    expect(googleClient.calendarExists).not.toHaveBeenCalled();
  });

  it("rejects an invalid state parameter and writes nothing", async () => {
    const res = await request(app)
      .get("/integrations/google/callback")
      .query({ code: "auth-code", state: "not-a-signed-state" });
    expect(res.status).toBe(400);
    expect(res.text).toMatch(/invalid or expired/i);

    const rows = await adminDb()
      .select()
      .from(coachCalendarIntegrations)
      .where(eq(coachCalendarIntegrations.coachProfileId, coach.userId));
    expect(rows).toHaveLength(0);
    const audit = await adminDb()
      .select()
      .from(coachAuditLog)
      .where(eq(coachAuditLog.coachId, coach.userId));
    expect(audit).toHaveLength(0);
  });

  it("redirects with google=cancelled when the user denies consent", async () => {
    const state = signState(coach.userId, STATE_SECRET);
    const res = await request(app)
      .get("/integrations/google/callback")
      .query({ state, error: "access_denied" });
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("google=cancelled");

    const rows = await adminDb()
      .select()
      .from(coachCalendarIntegrations)
      .where(eq(coachCalendarIntegrations.coachProfileId, coach.userId));
    expect(rows).toHaveLength(0);
  });
});

describe("GET /integrations/google/callback — reconnect flow", () => {
  async function seedActiveIntegration(opts: { status: "active" | "needs_reconnect" }): Promise<void> {
    // Encrypt a dummy refresh token so the row has valid cipher material.
    const { encryptToken } = await import("../../lib/tokenEncryption");
    const encrypted = encryptToken("existing-refresh-token", Buffer.from(KEY, "base64"));
    await adminDb().insert(coachCalendarIntegrations).values({
      coachProfileId: coach.userId,
      status: opts.status,
      googleCalendarId: "existing-calendar-id",
      googleAccountEmail: "coach-google@example.com",
      scope: "https://www.googleapis.com/auth/calendar.app.created",
      refreshTokenCiphertext: encrypted.ciphertext,
      refreshTokenIv: encrypted.iv,
      refreshTokenTag: encrypted.tag,
      refreshTokenKeyVersion: encrypted.keyVersion,
      ...(opts.status === "needs_reconnect" && { needsReconnectSince: new Date() }),
    });
  }

  it("reuses the existing calendar id when it still exists in Google", async () => {
    await seedActiveIntegration({ status: "needs_reconnect" });
    vi.mocked(googleClient.calendarExists).mockResolvedValueOnce({ exists: true });

    const state = signState(coach.userId, STATE_SECRET);
    const res = await request(app)
      .get("/integrations/google/callback")
      .query({ code: "auth-code", state });
    expect(res.status).toBe(302);

    expect(googleClient.calendarExists).toHaveBeenCalledWith(
      expect.anything(),
      "access-token-value",
      "existing-calendar-id",
    );
    expect(googleClient.createDedicatedCalendar).not.toHaveBeenCalled();

    const rows = await adminDb()
      .select()
      .from(coachCalendarIntegrations)
      .where(eq(coachCalendarIntegrations.coachProfileId, coach.userId));
    expect(rows[0]).toMatchObject({
      status: "active",
      googleCalendarId: "existing-calendar-id",
      needsReconnectSince: null,
    });

    const audit = await adminDb()
      .select()
      .from(coachAuditLog)
      .where(eq(coachAuditLog.coachId, coach.userId));
    expect(audit).toHaveLength(1);
    expect(audit[0]!.action).toBe("calendar_reconnected");
  });

  it("creates a new calendar when the existing one was deleted in Google", async () => {
    await seedActiveIntegration({ status: "needs_reconnect" });
    vi.mocked(googleClient.calendarExists).mockResolvedValueOnce({ exists: false });
    vi.mocked(googleClient.createDedicatedCalendar).mockResolvedValueOnce({
      id: "newly-created-calendar-id",
    });

    const state = signState(coach.userId, STATE_SECRET);
    await request(app).get("/integrations/google/callback").query({ code: "code", state });

    expect(googleClient.createDedicatedCalendar).toHaveBeenCalledTimes(1);
    const rows = await adminDb()
      .select()
      .from(coachCalendarIntegrations)
      .where(eq(coachCalendarIntegrations.coachProfileId, coach.userId));
    expect(rows[0]!.googleCalendarId).toBe("newly-created-calendar-id");
    expect(rows[0]!.status).toBe("active");
  });

  it("rolls back the integration row insert when the audit insert fails", async () => {
    // Force the audit insert to fail by sending a state that resolves to a
    // non-existent coach id — the audit row's coach_id FK (RESTRICT) will reject,
    // which should also roll back the calendar integration insert.
    const fakeCoachId = "99999999-9999-9999-9999-999999999999";
    const state = signState(fakeCoachId, STATE_SECRET);
    const res = await request(app)
      .get("/integrations/google/callback")
      .query({ code: "auth-code", state });
    expect(res.status).toBeGreaterThanOrEqual(500);

    const rows = await adminDb()
      .select()
      .from(coachCalendarIntegrations)
      .where(eq(coachCalendarIntegrations.coachProfileId, fakeCoachId));
    expect(rows).toHaveLength(0);
  });
});

describe("DELETE /coach/calendar", () => {
  it("returns 404 when there is no integration to disconnect", async () => {
    const res = await request(app)
      .delete("/coach/calendar")
      .set("Authorization", `Bearer ${coach.accessToken}`);
    expect(res.status).toBe(404);
  });

  it("revokes at Google, deletes the row, and writes a calendar_disconnected audit entry", async () => {
    const { encryptToken } = await import("../../lib/tokenEncryption");
    const encrypted = encryptToken("existing-refresh-token", Buffer.from(KEY, "base64"));
    await adminDb().insert(coachCalendarIntegrations).values({
      coachProfileId: coach.userId,
      status: "active",
      googleCalendarId: "existing-calendar-id",
      googleAccountEmail: "coach-google@example.com",
      scope: "https://www.googleapis.com/auth/calendar.app.created",
      refreshTokenCiphertext: encrypted.ciphertext,
      refreshTokenIv: encrypted.iv,
      refreshTokenTag: encrypted.tag,
      refreshTokenKeyVersion: encrypted.keyVersion,
    });

    const res = await request(app)
      .delete("/coach/calendar")
      .set("Authorization", `Bearer ${coach.accessToken}`);
    expect(res.status).toBe(204);

    expect(googleClient.revokeToken).toHaveBeenCalledTimes(1);
    expect(googleClient.revokeToken).toHaveBeenCalledWith(expect.anything(), "existing-refresh-token");

    const rows = await adminDb()
      .select()
      .from(coachCalendarIntegrations)
      .where(eq(coachCalendarIntegrations.coachProfileId, coach.userId));
    expect(rows).toHaveLength(0);

    const audit = await adminDb()
      .select()
      .from(coachAuditLog)
      .where(eq(coachAuditLog.coachId, coach.userId));
    expect(audit).toHaveLength(1);
    expect(audit[0]!.action).toBe("calendar_disconnected");
  });

  it("still deletes the local row when the Google revoke call fails", async () => {
    const { encryptToken } = await import("../../lib/tokenEncryption");
    const encrypted = encryptToken("existing-refresh-token", Buffer.from(KEY, "base64"));
    await adminDb().insert(coachCalendarIntegrations).values({
      coachProfileId: coach.userId,
      status: "active",
      googleCalendarId: "existing-calendar-id",
      googleAccountEmail: "coach-google@example.com",
      scope: "https://www.googleapis.com/auth/calendar.app.created",
      refreshTokenCiphertext: encrypted.ciphertext,
      refreshTokenIv: encrypted.iv,
      refreshTokenTag: encrypted.tag,
      refreshTokenKeyVersion: encrypted.keyVersion,
    });
    vi.mocked(googleClient.revokeToken).mockRejectedValueOnce(new Error("google 500"));

    const res = await request(app)
      .delete("/coach/calendar")
      .set("Authorization", `Bearer ${coach.accessToken}`);
    expect(res.status).toBe(204);

    const rows = await adminDb()
      .select()
      .from(coachCalendarIntegrations)
      .where(eq(coachCalendarIntegrations.coachProfileId, coach.userId));
    expect(rows).toHaveLength(0);
  });
});

describe("status endpoint reflects integration row state", () => {
  it("returns status='active' when the integration row is active", async () => {
    const { encryptToken } = await import("../../lib/tokenEncryption");
    const encrypted = encryptToken("rt", Buffer.from(KEY, "base64"));
    await adminDb().insert(coachCalendarIntegrations).values({
      coachProfileId: coach.userId,
      status: "active",
      googleCalendarId: "cal-id",
      googleAccountEmail: "coach-google@example.com",
      scope: "https://www.googleapis.com/auth/calendar.app.created",
      refreshTokenCiphertext: encrypted.ciphertext,
      refreshTokenIv: encrypted.iv,
      refreshTokenTag: encrypted.tag,
      refreshTokenKeyVersion: encrypted.keyVersion,
    });

    const res = await request(app)
      .get("/coach/calendar/status")
      .set("Authorization", `Bearer ${coach.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "active",
      connectedAccountEmail: "coach-google@example.com",
      googleCalendarId: "cal-id",
      needsReconnectSince: null,
    });
  });

  it("returns status='needs_reconnect' when the integration row has needs_reconnect state", async () => {
    const { encryptToken } = await import("../../lib/tokenEncryption");
    const encrypted = encryptToken("rt", Buffer.from(KEY, "base64"));
    await adminDb().insert(coachCalendarIntegrations).values({
      coachProfileId: coach.userId,
      status: "needs_reconnect",
      googleCalendarId: "cal-id",
      googleAccountEmail: "coach-google@example.com",
      scope: "https://www.googleapis.com/auth/calendar.app.created",
      refreshTokenCiphertext: encrypted.ciphertext,
      refreshTokenIv: encrypted.iv,
      refreshTokenTag: encrypted.tag,
      refreshTokenKeyVersion: encrypted.keyVersion,
      needsReconnectSince: new Date(),
    });

    const res = await request(app)
      .get("/coach/calendar/status")
      .set("Authorization", `Bearer ${coach.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("needs_reconnect");
    expect(res.body.needsReconnectSince).toEqual(expect.any(String));
  });
});
