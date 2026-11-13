// @vitest-environment node
import { vi, describe, expect, it } from "vitest";
import { mapApiResponse, AGE_ERROR } from "../content/SignupContent/helpers";
import { mapZodErrors } from "../lib/mapZodErrors";

// ── Signup server action — password confirm tests ──────────────────────────────

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));

vi.mock("@swim-app/shared", async (importOriginal) => {
  const original = await importOriginal<typeof import("@swim-app/shared")>();
  return { ...original };
});

vi.stubGlobal("fetch", mockFetch);

process.env["NEXT_PUBLIC_API_URL"] = "http://localhost:3001";
process.env["NEXT_PUBLIC_SITE_URL"] = "http://localhost:3000";

import { signup } from "../content/SignupContent/actions";

function makeFormData(fields: Record<string, string | null>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== null) formData.set(key, value);
  }
  return formData;
}

// ADR 036 Phase 8 Part B Stop 3: hidden version fields must be present
// so the server action's SignUpBodySchema.safeParse clears the strict
// `acceptedPolicyVersions` object. Server page renders these from the
// current shared constants.
import {
  PAYMENTS_REFUND_VERSION,
  PRIVACY_VERSION,
  TERMS_VERSION,
} from "@swim-app/shared";

const validFields = {
  fullName: "Jane Doe",
  email: "jane@example.com",
  phone: "",
  password: "securepassword123",
  confirmPassword: "securepassword123",
  birthDate: "1990-01-01",
  acceptedTerms: "on",
  termsVersion: TERMS_VERSION,
  privacyVersion: PRIVACY_VERSION,
  paymentsRefundVersion: PAYMENTS_REFUND_VERSION,
};

describe("signup server action — confirm password", () => {
  it("returns field_errors when passwords do not match", async () => {
    const formData = makeFormData({
      ...validFields,
      confirmPassword: "differentpassword",
    });

    const result = await signup({ status: "idle" }, formData);

    expect(result).toEqual({
      status: "field_errors",
      errors: { confirmPassword: "Passwords don't match." },
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("calls the API when passwords match", async () => {
    mockFetch.mockResolvedValueOnce({
      status: 201,
      json: async () => ({}),
    });

    const formData = makeFormData(validFields);
    const result = await signup({ status: "idle" }, formData);

    expect(mockFetch).toHaveBeenCalledOnce();
    expect(result).toEqual({ status: "success" });
  });
});

describe("mapZodErrors", () => {
  it("maps a single issue to its field", () => {
    const result = mapZodErrors([{ path: ["email"], message: "Invalid email" }]);
    expect(result).toEqual({ email: "Invalid email" });
  });

  it("keeps only the first error per field", () => {
    const result = mapZodErrors([
      { path: ["email"], message: "First error" },
      { path: ["email"], message: "Second error" },
    ]);
    expect(result).toEqual({ email: "First error" });
  });

  it("maps multiple fields independently", () => {
    const result = mapZodErrors([
      { path: ["email"], message: "Invalid email" },
      { path: ["password"], message: "Too short" },
    ]);
    expect(result).toEqual({ email: "Invalid email", password: "Too short" });
  });

  it("uses top-level path key only", () => {
    const result = mapZodErrors([{ path: ["nested", "field"], message: "Error" }]);
    expect(result).toEqual({ nested: "Error" });
  });

  it("uses _ for issues with no path", () => {
    const result = mapZodErrors([{ path: [], message: "Root error" }]);
    expect(result).toEqual({ _: "Root error" });
  });
});

describe("mapApiResponse", () => {
  it("201 → success", () => {
    expect(mapApiResponse(201, null)).toEqual({ status: "success" });
  });

  it("403 → field_errors with birthDate message regardless of body", () => {
    expect(mapApiResponse(403, { error: "Under 18" })).toEqual({
      status: "field_errors",
      errors: { birthDate: AGE_ERROR },
    });
  });

  it("422 with issues → field_errors", () => {
    const body = {
      error: "Validation error",
      issues: [{ path: ["email"], message: "Invalid email" }],
    };
    expect(mapApiResponse(422, body)).toEqual({
      status: "field_errors",
      errors: { email: "Invalid email" },
    });
  });

  it("400 → generic error regardless of API message", () => {
    expect(mapApiResponse(400, { error: "Could not create account" })).toEqual({
      status: "error",
      message: "Something went wrong. Please try again.",
    });
  });

  it("500 → generic error", () => {
    expect(mapApiResponse(500, {})).toEqual({
      status: "error",
      message: "Something went wrong. Please try again.",
    });
  });

  it("unknown status with no parseable body → generic error", () => {
    expect(mapApiResponse(503, null)).toEqual({
      status: "error",
      message: "Something went wrong. Please try again.",
    });
  });
});
