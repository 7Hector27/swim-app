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
vi.mock("../../services/googleCalendarClient", async () => {
  // Keep the real `toSafeGoogleError` implementation — it's a pure function
  // and the catch blocks in the routes rely on it. Only the HTTP-touching
  // functions are stubbed.
  const actual = await vi.importActual<typeof import("../../services/googleCalendarClient")>(
    "../../services/googleCalendarClient",
  );
  return {
    ...actual,
    CALENDAR_SCOPE: "https://www.googleapis.com/auth/calendar.app.created",
    getAuthorizeUrl: vi.fn(),
    exchangeCodeForTokens: vi.fn(),
    calendarExists: vi.fn(),
    createDedicatedCalendar: vi.fn(),
    revokeToken: vi.fn(),
  };
});

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

// Every callback redirect — success or failure — must land on a fully
// absolute web URL whose origin matches SITE_URL. A regression where some
// branch used `res.redirect("/account?...")` with a bare path would silently
// pass against a .toContain("/account") check, so these helpers parse the
// Location header into a URL and enforce origin + path + param.
const EXPECTED_WEB_ORIGIN = new URL(process.env["SITE_URL"] ?? "http://localhost:3000").origin;

function expectCallbackRedirect(location: unknown, googleParam: "connected" | "error"): void {
  expect(typeof location).toBe("string");
  // Fails cleanly on relative paths — new URL() of "/account?x" throws.
  expect(() => new URL(location as string)).not.toThrow();
  const url = new URL(location as string);
  expect(url.origin).toBe(EXPECTED_WEB_ORIGIN);
  expect(url.pathname).toBe("/account");
  expect(url.searchParams.get("google")).toBe(googleParam);
}

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
    expectCallbackRedirect(res.headers.location, "connected");

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
    expect(rows[0]!.refreshTokenCiphertext!.length).toBeGreaterThan(0);
    expect(rows[0]!.refreshTokenIv!.length).toBe(12);
    expect(rows[0]!.refreshTokenTag!.length).toBe(16);

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

  it("redirects to /account?google=error on an invalid state and writes nothing", async () => {
    const res = await request(app)
      .get("/integrations/google/callback")
      .query({ code: "auth-code", state: "not-a-signed-state" });
    expect(res.status).toBe(302);
    expectCallbackRedirect(res.headers.location, "error");

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

  it("redirects to /account?google=error when the user denies consent", async () => {
    const state = signState(coach.userId, STATE_SECRET);
    const res = await request(app)
      .get("/integrations/google/callback")
      .query({ state, error: "access_denied" });
    expect(res.status).toBe(302);
    expectCallbackRedirect(res.headers.location, "error");

    const rows = await adminDb()
      .select()
      .from(coachCalendarIntegrations)
      .where(eq(coachCalendarIntegrations.coachProfileId, coach.userId));
    expect(rows).toHaveLength(0);
  });

  it("redirects to /account?google=error when Google itself returns an error", async () => {
    const state = signState(coach.userId, STATE_SECRET);
    const res = await request(app)
      .get("/integrations/google/callback")
      .query({ state, error: "server_error", error_description: "temporarily unavailable" });
    expect(res.status).toBe(302);
    expectCallbackRedirect(res.headers.location, "error");
  });

  it("redirects to /account?google=error when the token exchange throws", async () => {
    vi.mocked(googleClient.exchangeCodeForTokens).mockRejectedValueOnce(
      new Error("google: invalid_grant"),
    );
    const state = signState(coach.userId, STATE_SECRET);
    const res = await request(app)
      .get("/integrations/google/callback")
      .query({ code: "auth-code", state });
    expect(res.status).toBe(302);
    expectCallbackRedirect(res.headers.location, "error");

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

  it("redirects to /account?google=error when calendar creation throws", async () => {
    vi.mocked(googleClient.createDedicatedCalendar).mockRejectedValueOnce(
      new Error("google: 500"),
    );
    const state = signState(coach.userId, STATE_SECRET);
    const res = await request(app)
      .get("/integrations/google/callback")
      .query({ code: "auth-code", state });
    expect(res.status).toBe(302);
    expectCallbackRedirect(res.headers.location, "error");

    const rows = await adminDb()
      .select()
      .from(coachCalendarIntegrations)
      .where(eq(coachCalendarIntegrations.coachProfileId, coach.userId));
    expect(rows).toHaveLength(0);
  });

  it("completes the connection when Google returns no id_token email (realistic response shape)", async () => {
    // This is what Google returns for the common configurations where no
    // id_token is issued — the shape that broke the real-world flow before
    // the fix. The mock mirrors the structure precisely: no email field.
    vi.mocked(googleClient.exchangeCodeForTokens).mockResolvedValueOnce({
      refreshToken: "refresh-token-value",
      accessToken: "access-token-value",
      email: null,
      scope: "openid email https://www.googleapis.com/auth/calendar.app.created",
    });

    const state = signState(coach.userId, STATE_SECRET);
    const res = await request(app)
      .get("/integrations/google/callback")
      .query({ code: "auth-code", state });
    expect(res.status).toBe(302);
    expectCallbackRedirect(res.headers.location, "connected");

    const rows = await adminDb()
      .select()
      .from(coachCalendarIntegrations)
      .where(eq(coachCalendarIntegrations.coachProfileId, coach.userId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.googleAccountEmail).toBeNull();
    expect(rows[0]!.status).toBe("active");

    // The status endpoint reflects the null email so the card can show
    // "Connected" without an address.
    const statusRes = await request(app)
      .get("/coach/calendar/status")
      .set("Authorization", `Bearer ${coach.accessToken}`);
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.status).toBe("active");
    expect(statusRes.body.connectedAccountEmail).toBeNull();
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
    // The DB write is now caught and redirected to /account?google=error so
    // the coach doesn't see a raw error page. The rollback behavior is the
    // same — nothing committed.
    expect(res.status).toBe(302);
    expectCallbackRedirect(res.headers.location, "error");

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

  it("revokes at Google, flips the row to 'disconnected' with cleared tokens, and writes calendar_disconnected", async () => {
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

    // The row persists; only the token material and scope are cleared, and
    // the google_calendar_id survives so the next connect can reuse it.
    const rows = await adminDb()
      .select()
      .from(coachCalendarIntegrations)
      .where(eq(coachCalendarIntegrations.coachProfileId, coach.userId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "disconnected",
      googleCalendarId: "existing-calendar-id",
      // The coach's personal Google address is cleared on disconnect.
      // We only retain it while there's a reason to display it (active
      // or needs_reconnect); after an explicit disconnect it serves
      // no purpose.
      googleAccountEmail: null,
      refreshTokenCiphertext: null,
      refreshTokenIv: null,
      refreshTokenTag: null,
      refreshTokenKeyVersion: null,
      scope: null,
      needsReconnectSince: null,
    });

    const audit = await adminDb()
      .select()
      .from(coachAuditLog)
      .where(eq(coachAuditLog.coachId, coach.userId));
    expect(audit).toHaveLength(1);
    expect(audit[0]!.action).toBe("calendar_disconnected");
  });

  it("still flips the row to 'disconnected' when the Google revoke call fails", async () => {
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
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("disconnected");
    expect(rows[0]!.refreshTokenCiphertext).toBeNull();
  });

  it("returns 404 when the integration is already in 'disconnected' state", async () => {
    // Seed a disconnected row (what a prior disconnect leaves behind).
    await adminDb().insert(coachCalendarIntegrations).values({
      coachProfileId: coach.userId,
      status: "disconnected",
      googleCalendarId: "existing-calendar-id",
      googleAccountEmail: "coach-google@example.com",
    });

    const res = await request(app)
      .delete("/coach/calendar")
      .set("Authorization", `Bearer ${coach.accessToken}`);
    expect(res.status).toBe(404);
    expect(googleClient.revokeToken).not.toHaveBeenCalled();
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
    // The email stays visible on needs_reconnect so the Reconnect UI
    // can show the coach which Google account to re-authorize.
    expect(res.body.connectedAccountEmail).toBe("coach-google@example.com");
  });

  it("maps a 'disconnected' row to status='not_connected' on the response (calendar id hidden)", async () => {
    // Row exists but was disconnected — the UI should see the "not connected"
    // state and show the Connect button. The server retains the calendar id
    // internally for reuse on the next connect, but the client never sees it.
    await adminDb().insert(coachCalendarIntegrations).values({
      coachProfileId: coach.userId,
      status: "disconnected",
      googleCalendarId: "existing-calendar-id",
      googleAccountEmail: "coach-google@example.com",
    });

    const res = await request(app)
      .get("/coach/calendar/status")
      .set("Authorization", `Bearer ${coach.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "not_connected",
      connectedAccountEmail: null,
      googleCalendarId: null,
      connectedAt: null,
    });
  });
});

describe("connect → disconnect → connect round-trip", () => {
  it("reuses the same google_calendar_id across the full cycle (no new calendar created on reconnect)", async () => {
    // First connect — new row, new calendar created.
    vi.mocked(googleClient.createDedicatedCalendar).mockResolvedValueOnce({
      id: "the-one-and-only-calendar-id",
    });
    const connectState1 = signState(coach.userId, STATE_SECRET);
    await request(app)
      .get("/integrations/google/callback")
      .query({ code: "code-1", state: connectState1 });

    let rows = await adminDb()
      .select()
      .from(coachCalendarIntegrations)
      .where(eq(coachCalendarIntegrations.coachProfileId, coach.userId));
    expect(rows[0]!.googleCalendarId).toBe("the-one-and-only-calendar-id");
    expect(rows[0]!.status).toBe("active");

    // Disconnect — row flipped to 'disconnected', calendar id preserved.
    const disconnectRes = await request(app)
      .delete("/coach/calendar")
      .set("Authorization", `Bearer ${coach.accessToken}`);
    expect(disconnectRes.status).toBe(204);

    rows = await adminDb()
      .select()
      .from(coachCalendarIntegrations)
      .where(eq(coachCalendarIntegrations.coachProfileId, coach.userId));
    expect(rows[0]!.status).toBe("disconnected");
    expect(rows[0]!.googleCalendarId).toBe("the-one-and-only-calendar-id");

    // Second connect — calendars.get succeeds, reuse the id, no insert.
    vi.mocked(googleClient.createDedicatedCalendar).mockClear();
    vi.mocked(googleClient.calendarExists).mockResolvedValueOnce({ exists: true });
    const connectState2 = signState(coach.userId, STATE_SECRET);
    await request(app)
      .get("/integrations/google/callback")
      .query({ code: "code-2", state: connectState2 });

    expect(googleClient.calendarExists).toHaveBeenCalledWith(
      expect.anything(),
      "access-token-value",
      "the-one-and-only-calendar-id",
    );
    expect(googleClient.createDedicatedCalendar).not.toHaveBeenCalled();

    rows = await adminDb()
      .select()
      .from(coachCalendarIntegrations)
      .where(eq(coachCalendarIntegrations.coachProfileId, coach.userId));
    expect(rows[0]!.googleCalendarId).toBe("the-one-and-only-calendar-id");
    expect(rows[0]!.status).toBe("active");
    expect(rows[0]!.refreshTokenCiphertext).not.toBeNull();

    // Audit trail: connect, disconnect, reconnect.
    const audit = await adminDb()
      .select()
      .from(coachAuditLog)
      .where(eq(coachAuditLog.coachId, coach.userId));
    const actions = audit.map((a) => a.action).sort();
    expect(actions).toEqual(["calendar_connected", "calendar_disconnected", "calendar_reconnected"]);
  });
});
