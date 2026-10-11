import { describe, expect, it } from "vitest";

import { mapApiResponse } from "../content/AddSwimmerContent/helpers";

describe("mapApiResponse (AddSwimmerContent)", () => {
  it("returns error with unavailable-clubs message on 400", () => {
    const result = mapApiResponse(400, { error: "Unknown club" });
    expect(result.status).toBe("error");
    expect("message" in result && result.message).toContain("no longer available");
  });

  it("maps 422 Zod issues to field_errors", () => {
    const result = mapApiResponse(422, {
      error: "Validation failed",
      issues: [{ path: ["firstName"], message: "Required" }],
    });
    expect(result.status).toBe("field_errors");
    expect("errors" in result && result.errors["firstName"]).toBe("Required");
  });

  it("maps 422 with multiple issues, first one wins per field", () => {
    const result = mapApiResponse(422, {
      issues: [
        { path: ["birthDate"], message: "Invalid date" },
        { path: ["birthDate"], message: "Must be in the past" },
      ],
    });
    expect(result.status).toBe("field_errors");
    expect("errors" in result && result.errors["birthDate"]).toBe("Invalid date");
  });

  it("returns generic error when 422 body has no issues array", () => {
    const result = mapApiResponse(422, { error: "Validation failed" });
    expect(result.status).toBe("error");
  });

  it("returns generic error on 500", () => {
    const result = mapApiResponse(500, null);
    expect(result.status).toBe("error");
    expect("message" in result && result.message).toContain("Something went wrong");
  });

  it("returns generic error on 503", () => {
    const result = mapApiResponse(503, null);
    expect(result.status).toBe("error");
  });

  it("returns generic error when body is not an object", () => {
    const result = mapApiResponse(422, "plain string");
    expect(result.status).toBe("error");
  });
});
