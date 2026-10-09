import { describe, expect, it } from "vitest";
import { mapMeStatus } from "../lib/api/me";

const validProfile = { fullName: "Jane Doe", phone: null, role: "parent" as const };

describe("mapMeStatus", () => {
  it("200 with body → ok with profile", () => {
    expect(mapMeStatus(200, validProfile)).toEqual({ ok: true, profile: validProfile });
  });

  it("401 → not ok with status 401", () => {
    expect(mapMeStatus(401, null)).toEqual({ ok: false, status: 401 });
  });

  it("403 → not ok with status 403", () => {
    expect(mapMeStatus(403, { error: "Forbidden" })).toEqual({ ok: false, status: 403 });
  });

  it("500 → not ok with status 500", () => {
    expect(mapMeStatus(500, {})).toEqual({ ok: false, status: 500 });
  });

  it("503 → not ok with status 503", () => {
    expect(mapMeStatus(503, null)).toEqual({ ok: false, status: 503 });
  });
});
