import { describe, expect, it } from "vitest";
import { mapApiResponse } from "../content/SignupContent/helpers";
import { mapZodErrors } from "../lib/mapZodErrors";

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

  it("403 → age_blocked regardless of body", () => {
    expect(mapApiResponse(403, { error: "Under 18" })).toEqual({
      status: "age_blocked",
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
