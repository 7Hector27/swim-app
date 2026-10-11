import { describe, expect, it } from "vitest";
import { mapHideApiResponse } from "../content/CoachSwimmerDetailContent/helpers";

describe("mapHideApiResponse", () => {
  it("returns idle on 204", () => {
    expect(mapHideApiResponse(204)).toEqual({ status: "idle" });
  });

  it("returns error with not-found message on 404", () => {
    const state = mapHideApiResponse(404);
    expect(state.status).toBe("error");
    if (state.status === "error") {
      expect(state.message).toMatch(/not found/i);
    }
  });

  it("returns generic error on unexpected status", () => {
    const state = mapHideApiResponse(500);
    expect(state.status).toBe("error");
    if (state.status === "error") {
      expect(state.message).toMatch(/something went wrong/i);
    }
  });

  it("returns generic error on 400", () => {
    const state = mapHideApiResponse(400);
    expect(state.status).toBe("error");
  });
});
