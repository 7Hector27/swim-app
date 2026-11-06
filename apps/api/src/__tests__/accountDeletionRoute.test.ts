// Unit tests for POST /me/deletion/confirm, mocking Supabase + db so
// we can exercise edge cases that the integration tests can't reach:
// an auth user id that doesn't match the caller's profile id (the
// Supabase trigger normally enforces equality) and the log-safety
// behavior when the Admin API returns an error whose .message would
// otherwise echo the user's email.

import { vi, describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import pino from "pino";

const {
  mockGetUser,
  mockReauthSignIn,
  mockReauthSignOut,
  mockDbSelect,
  mockDbTransaction,
  mockDbUpdate,
  mockAdminDeleteUser,
  safeErrSummarySpy,
} = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockReauthSignIn: vi.fn(),
  mockReauthSignOut: vi.fn(),
  mockDbSelect: vi.fn(),
  mockDbTransaction: vi.fn(),
  mockDbUpdate: vi.fn(),
  mockAdminDeleteUser: vi.fn(),
  safeErrSummarySpy: vi.fn(),
}));

// The module-level Supabase client is used only by requireUser.getUser.
vi.mock("../lib/supabase", () => ({
  supabase: { auth: { getUser: mockGetUser } },
}));

// The admin client is used in the post-commit fan-out to hard-delete
// the auth user. Mocked so the test doesn't call Supabase for real.
vi.mock("../lib/supabaseAdmin", () => ({
  supabaseAdmin: {
    auth: { admin: { deleteUser: mockAdminDeleteUser } },
  },
}));

// The route constructs a fresh client via createClient() for the
// re-auth password check. Mock @supabase/supabase-js so that call
// returns a client wired to our mocks.
vi.mock("@supabase/supabase-js", async () => {
  const actual = await vi.importActual<typeof import("@supabase/supabase-js")>(
    "@supabase/supabase-js",
  );
  return {
    ...actual,
    createClient: vi.fn(() => ({
      auth: {
        signInWithPassword: mockReauthSignIn,
        signOut: mockReauthSignOut,
      },
    })),
  };
});

// Minimal db mock. The success-path tests verify route behavior that
// doesn't actually commit; the mismatch test short-circuits before any
// db call.
vi.mock("../db/client", () => ({
  db: {
    select: mockDbSelect,
    transaction: mockDbTransaction,
    update: mockDbUpdate,
  },
}));

import { createApp } from "../app";

const PROFILE_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_AUTH_USER_ID = "22222222-2222-2222-2222-222222222222";

const baseProfile = {
  id: PROFILE_ID,
  role: "parent" as const,
  fullName: "Test User",
  phone: null,
  ageAttestedAt: new Date(),
  disabledAt: null,
  email: "jane@example.com",
  emailVerifiedAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
};

// A capture-everything logger. We run assertions against each line.
const capturedLogs: Array<{ level: string; obj: Record<string, unknown>; msg: string }> = [];
const testLogger = pino({
  level: "trace",
}, {
  write: (chunk: string) => {
    try {
      const parsed = JSON.parse(chunk);
      capturedLogs.push({
        level: String(parsed.level),
        obj: parsed,
        msg: String(parsed.msg ?? ""),
      });
    } catch {
      /* non-JSON chunk from pino internals, ignore */
    }
  },
});

const app = createApp(testLogger);

function authAsOwner(): void {
  mockGetUser.mockResolvedValue({
    data: { user: { id: PROFILE_ID, email: "jane@example.com" } },
    error: null,
  });
  mockDbSelect.mockImplementation(() => ({
    from: () => ({
      where: () => Promise.resolve([baseProfile]),
    }),
  }));
}

beforeEach(() => {
  vi.resetAllMocks();
  capturedLogs.length = 0;
  // Keep the sign-out mock resolving by default — the route always calls
  // it, success or failure.
  mockReauthSignOut.mockResolvedValue({ error: null });
  // The admin delete happens inside a post-commit microtask. Resolve to
  // success by default so the tests don't hang.
  mockAdminDeleteUser.mockResolvedValue({ data: null, error: null });
  safeErrSummarySpy.mockClear();
});

describe("POST /me/deletion/confirm (unit)", () => {
  it("returns 500 and logs an id-mismatch event when Supabase reports a different user id than the profile", async () => {
    authAsOwner();
    // Re-auth succeeds — but with a DIFFERENT user id than the profile.
    mockReauthSignIn.mockResolvedValue({
      data: { user: { id: OTHER_AUTH_USER_ID, email: "jane@example.com" } },
      error: null,
    });

    const res = await request(app)
      .post("/me/deletion/confirm")
      .set("Authorization", "Bearer token")
      .send({ password: "any-password", confirmationPhrase: "delete my account" });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("account_deletion_id_mismatch");

    // signOut was called on the re-auth client (success path) so no
    // extra Supabase session lingers for the deleted-but-not-matched
    // auth user. Scope MUST be "local" — Supabase's default global
    // scope would also kill the parent's live browser session and
    // sign them out of the rest of the app on a failed confirm.
    expect(mockReauthSignOut).toHaveBeenCalledTimes(1);
    expect(mockReauthSignOut).toHaveBeenCalledWith({ scope: "local" });

    // The id-mismatch event was logged with UUIDs only — no email, no
    // password, no raw error message.
    const mismatchLogs = capturedLogs.filter(
      (log) => log.obj["event"] === "account_deletion_id_mismatch",
    );
    expect(mismatchLogs).toHaveLength(1);
    const payload = mismatchLogs[0]!.obj;
    expect(payload["profileId"]).toBe(PROFILE_ID);
    expect(payload["authUserId"]).toBe(OTHER_AUTH_USER_ID);
    expect(JSON.stringify(payload)).not.toContain("jane@example.com");
    expect(JSON.stringify(payload)).not.toContain("any-password");

    // The handler short-circuited before the transaction: no db calls
    // for the deletion itself.
    expect(mockDbTransaction).not.toHaveBeenCalled();
    // No admin delete either — the mismatch check guards against
    // calling deleteUser with the wrong UUID.
    expect(mockAdminDeleteUser).not.toHaveBeenCalled();
  });

  it("signs out on password-mismatch too, so a failed re-auth never leaves a session behind", async () => {
    authAsOwner();
    mockReauthSignIn.mockResolvedValue({
      data: { user: null },
      error: { message: "Invalid login credentials", status: 400, name: "AuthApiError" },
    });

    const res = await request(app)
      .post("/me/deletion/confirm")
      .set("Authorization", "Bearer token")
      .send({ password: "wrong", confirmationPhrase: "delete my account" });

    // 403 invalid_password, not 401 — the web client's convention is
    // to sign the user out on any 401 from the API, and a wrong
    // confirmation-password must not sign the still-live session out.
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("invalid_password");
    // signOut on the re-auth client ran, with scope "local" so only
    // the API-side session the re-auth minted gets invalidated.
    // Supabase's default global scope would also kill the parent's
    // browser session and sign them out of the rest of the app —
    // exactly the symptom the user reported after a failed confirm.
    expect(mockReauthSignOut).toHaveBeenCalledTimes(1);
    expect(mockReauthSignOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("re-auth sign-out never uses Supabase's default global scope — guards the parent's live browser session against failed-confirm sign-outs", async () => {
    // One-line regression guard. The user reported that any failed
    // confirm (403 wrong password, 500 mid-tx) also signed them out
    // of the live app. Root cause: `authCheckClient.auth.signOut()`
    // defaulted to scope "global" which revokes every refresh token
    // for that user, including the one the browser was holding. This
    // test fails loudly if any future refactor drops the explicit
    // scope argument on any of the sign-out code paths.
    authAsOwner();
    mockReauthSignIn.mockResolvedValue({
      data: { user: { id: PROFILE_ID, email: "jane@example.com" } },
      error: null,
    });
    // Short-circuit the deletion tx to an internal error so the test
    // doesn't need to seed real DB state; the sign-out ran before
    // this point.
    mockDbTransaction.mockRejectedValueOnce(new Error("test short-circuit"));

    await request(app)
      .post("/me/deletion/confirm")
      .set("Authorization", "Bearer token")
      .send({ password: "any", confirmationPhrase: "delete my account" });

    expect(mockReauthSignOut).toHaveBeenCalled();
    for (const call of mockReauthSignOut.mock.calls) {
      const arg = call[0] as { scope?: string } | undefined;
      expect(arg?.scope).toBe("local");
    }
  });

  it("safeErrSummary never surfaces a Supabase error's .message to the log (would otherwise echo the user's email)", async () => {
    // Direct smoke test of the helper. The route-level log safety
    // is covered by this unit + the existing integration suite.
    const { safeErrSummary } = await import("../routes/accountDeletion");
    const err = {
      name: "AuthApiError",
      code: "user_not_found",
      status: 404,
      message: "User jane@example.com not found",
    };
    const summary = safeErrSummary(err);
    expect(summary).toEqual({ name: "AuthApiError", code: "user_not_found", status: 404 });
    expect(JSON.stringify(summary)).not.toContain("jane@example.com");
  });

  it("safeErrSummary handles thrown non-object values without leaking anything", async () => {
    const { safeErrSummary } = await import("../routes/accountDeletion");
    expect(safeErrSummary("jane@example.com not found")).toEqual({
      name: "Error",
      code: null,
      status: null,
    });
    expect(safeErrSummary(null)).toEqual({ name: "Error", code: null, status: null });
    expect(safeErrSummary(undefined)).toEqual({ name: "Error", code: null, status: null });
  });
});
