import { describe, it, expect } from "vitest";
import { buildHealthResponse } from "../health";

describe("buildHealthResponse", () => {
  it("returns status ok when db is reachable", () => {
    const res = buildHealthResponse(true);
    expect(res.status).toBe("ok");
    expect(res.db).toBe(true);
    expect(new Date(res.timestamp).getTime()).not.toBeNaN();
  });

  it("returns status error when db is unreachable", () => {
    const res = buildHealthResponse(false);
    expect(res.status).toBe("error");
    expect(res.db).toBe(false);
  });
});
