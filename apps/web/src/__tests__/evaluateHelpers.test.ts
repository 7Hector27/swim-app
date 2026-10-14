import { describe, it, expect } from "vitest";
import { mapSubmitResponse } from "../content/EvaluateContent/helpers";

describe("mapSubmitResponse", () => {
  it("returns saved state on 201 with valid body", () => {
    const body = {
      sessionId: "00000000-0000-0000-0000-000000000001",
      ratingIds: ["00000000-0000-0000-0000-000000000002"],
    };
    expect(mapSubmitResponse(201, body)).toEqual({
      status: "saved",
      sessionId: body.sessionId,
      ratingIds: body.ratingIds,
    });
  });

  it("returns saved state on 201 with empty ratingIds", () => {
    const body = { sessionId: "00000000-0000-0000-0000-000000000001", ratingIds: [] };
    expect(mapSubmitResponse(201, body)).toEqual({
      status: "saved",
      sessionId: body.sessionId,
      ratingIds: [],
    });
  });

  it("returns error on 201 with missing ratingIds", () => {
    const result = mapSubmitResponse(201, { sessionId: "abc" });
    expect(result.status).toBe("error");
  });

  it("returns error on 201 with missing sessionId", () => {
    const result = mapSubmitResponse(201, { ratingIds: [] });
    expect(result.status).toBe("error");
  });

  it("returns error on 201 when ratingIds contains non-string", () => {
    const result = mapSubmitResponse(201, { sessionId: "abc", ratingIds: [123] });
    expect(result.status).toBe("error");
  });

  it("returns error on 422", () => {
    const result = mapSubmitResponse(422, null);
    expect(result.status).toBe("error");
    expect(result.status === "error" && result.message).toContain("invalid");
  });

  it("returns error on 404", () => {
    const result = mapSubmitResponse(404, null);
    expect(result.status).toBe("error");
  });

  it("returns error on 500", () => {
    const result = mapSubmitResponse(500, null);
    expect(result.status).toBe("error");
  });

  it("returns error on null body with 201", () => {
    const result = mapSubmitResponse(201, null);
    expect(result.status).toBe("error");
  });
});
