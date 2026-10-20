import { describe, expect, it } from "vitest";

import { mapApiResponse, mapPublicToggleApiResponse } from "../content/EditSwimmerContent/helpers";

describe("mapPublicToggleApiResponse", () => {
  it("returns idle on 200 (toggle succeeded)", () => {
    const result = mapPublicToggleApiResponse(200);
    expect(result.status).toBe("idle");
  });

  it("returns owner-only error on 403 (consent required to turn on)", () => {
    const result = mapPublicToggleApiResponse(403);
    expect(result.status).toBe("error");
    expect("message" in result && result.message).toMatch(/household owner/i);
  });

  it("returns not-found error on 404", () => {
    const result = mapPublicToggleApiResponse(404);
    expect(result.status).toBe("error");
    expect("message" in result && result.message).toMatch(/not found/i);
  });

  it("returns generic error on 500", () => {
    const result = mapPublicToggleApiResponse(500);
    expect(result.status).toBe("error");
    expect("message" in result && result.message).toMatch(/something went wrong/i);
  });
});

describe("mapApiResponse (EditSwimmerContent)", () => {
  it("returns unavailable-clubs error on 400", () => {
    const result = mapApiResponse(400, null);
    expect(result.status).toBe("error");
    expect("message" in result && result.message).toContain("no longer available");
  });

  it("returns permission error on 403 (viewers can't change)", () => {
    const result = mapApiResponse(403, null);
    expect(result.status).toBe("error");
    expect("message" in result && result.message).toMatch(/permission/i);
  });

  it("returns not-found error on 404", () => {
    const result = mapApiResponse(404, null);
    expect(result.status).toBe("error");
    expect("message" in result && result.message).toMatch(/not found/i);
  });

  it("maps 422 with Zod issues to field_errors", () => {
    const result = mapApiResponse(422, {
      error: "Validation failed",
      issues: [{ path: ["firstName"], message: "Required" }],
    });
    expect(result.status).toBe("field_errors");
    expect("errors" in result && result.errors["firstName"]).toBe("Required");
  });

  it("returns generic error on 500", () => {
    const result = mapApiResponse(500, null);
    expect(result.status).toBe("error");
    expect("message" in result && result.message).toMatch(/something went wrong/i);
  });
});

describe("public toggle consent logic (turning off works)", () => {
  it("idle state after 200 allows re-enabling without lingering errors", () => {
    const offResult = mapPublicToggleApiResponse(200);
    expect(offResult.status).toBe("idle");
    const onResult = mapPublicToggleApiResponse(200);
    expect(onResult.status).toBe("idle");
  });

  it("non-owner gets a clear rejection when trying to enable", () => {
    const result = mapPublicToggleApiResponse(403);
    expect(result.status).toBe("error");
    const message = "message" in result ? result.message : "";
    expect(message).not.toContain("club");
    expect(message.toLowerCase()).toContain("owner");
  });
});
