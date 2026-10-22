// Verifies that gaxios-shaped Google errors are flattened to the safe log
// shape and that nothing from the error's `.config`, `.request`, or
// `.response.config` ever makes it into the output. This is the shape the
// `googleapis` + `google-auth-library` stack throws.

import { describe, expect, it } from "vitest";
import { toSafeGoogleError } from "../services/googleCalendarClient";

describe("toSafeGoogleError", () => {
  it("extracts status, googleErrorCode, and message from a realistic gaxios error", () => {
    const err = buildGaxiosError({
      status: 400,
      message: "invalid_grant",
      data: { error: "invalid_grant", error_description: "Bad Request" },
    });
    const safe = toSafeGoogleError(err);
    expect(safe.status).toBe(400);
    expect(safe.googleErrorCode).toBe("invalid_grant");
    expect(safe.message).toBe("Bad Request");
  });

  it("falls back to err.message when response.data has no error_description", () => {
    const err = buildGaxiosError({ status: 500, message: "googleapis: unexpected", data: {} });
    const safe = toSafeGoogleError(err);
    expect(safe.message).toBe("googleapis: unexpected");
    expect(safe.status).toBe(500);
    expect(safe.googleErrorCode).toBeUndefined();
  });

  it("drops config, headers, request body, and the raw error object", () => {
    const err = buildGaxiosError({
      status: 400,
      message: "oops",
      data: { error: "invalid_grant" },
      // These are the leak-prone fields on a real gaxios error.
      config: {
        url: "https://oauth2.googleapis.com/token",
        headers: { Authorization: "Bearer ya29.AVERYLONGACCESSTOKENVALUE" },
        data: "code=4%2F0AY_SECRET_AUTHORIZATION_CODE_FROM_GOOGLE&grant_type=authorization_code",
      },
      request: {
        responseURL: "https://oauth2.googleapis.com/token",
        headers: { Authorization: "Bearer ya29.ANOTHERTOKENVALUE" },
      },
    });

    const safe = toSafeGoogleError(err);
    const serialized = JSON.stringify(safe);

    // The three known-sensitive strings from the fixture must not appear
    // anywhere in the output.
    expect(serialized).not.toContain("ya29.AVERYLONGACCESSTOKENVALUE");
    expect(serialized).not.toContain("ya29.ANOTHERTOKENVALUE");
    expect(serialized).not.toContain("4%2F0AY_SECRET_AUTHORIZATION_CODE_FROM_GOOGLE");
    expect(serialized).not.toContain("Authorization");
    expect(serialized).not.toContain("Bearer");
    // Only the three safe keys should be present.
    expect(Object.keys(safe).sort()).toEqual(["googleErrorCode", "message", "status"]);
  });

  it("scrubs Bearer-shaped tokens even if they appear in error_description", () => {
    const err = buildGaxiosError({
      status: 401,
      message: "unauthorized",
      data: {
        error: "unauthorized",
        error_description: "Rejected token: Bearer ya29.VERYLONGACCESSTOKENVALUE12345",
      },
    });
    const safe = toSafeGoogleError(err);
    expect(safe.message).toContain("[REDACTED]");
    expect(safe.message).not.toContain("ya29.VERYLONGACCESSTOKENVALUE12345");
  });

  it("scrubs code=... tokens if they appear in error_description", () => {
    const err = buildGaxiosError({
      status: 400,
      message: "invalid_request",
      data: {
        error: "invalid_request",
        error_description: "unknown parameter code=4%2F0AY_SECRET_LONG_CODE_HERE_12345",
      },
    });
    const safe = toSafeGoogleError(err);
    expect(safe.message).toContain("[REDACTED]");
    expect(safe.message).not.toContain("4%2F0AY_SECRET_LONG_CODE_HERE_12345");
  });

  it("handles a plain Error without any gaxios fields", () => {
    const safe = toSafeGoogleError(new Error("network down"));
    expect(safe.message).toBe("network down");
    expect(safe.status).toBeUndefined();
    expect(safe.googleErrorCode).toBeUndefined();
  });

  it("handles non-Error throws (strings, undefined)", () => {
    expect(toSafeGoogleError("something broke").message).toBe("something broke");
    expect(toSafeGoogleError(undefined).message).toBe("undefined");
  });
});

interface GaxiosErrorShape {
  status: number;
  message: string;
  data: Record<string, unknown>;
  config?: Record<string, unknown>;
  request?: Record<string, unknown>;
}

function buildGaxiosError(opts: GaxiosErrorShape): Error & Record<string, unknown> {
  const err = new Error(opts.message) as Error & Record<string, unknown>;
  err["status"] = opts.status;
  err["code"] = opts.status;
  err["response"] = { status: opts.status, data: opts.data };
  if (opts.config) err["config"] = opts.config;
  if (opts.request) err["request"] = opts.request;
  return err;
}
