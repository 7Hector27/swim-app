import { describe, expect, it } from "vitest";
import { mapMeStatus } from "../lib/api/me";

const validProfile = { fullName: "Jane Doe", phone: null, role: "parent" as const };
const coachProfile = { fullName: "Jason G", phone: null, role: "coach" as const };

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

describe("mapMeStatus — role field", () => {
  it("coach profile → role is coach", () => {
    const result = mapMeStatus(200, coachProfile);
    expect(result).toEqual({ ok: true, profile: coachProfile });
    if (result.ok) expect(result.profile.role).toBe("coach");
  });

  it("parent profile → role is parent", () => {
    const result = mapMeStatus(200, validProfile);
    if (result.ok) expect(result.profile.role).toBe("parent");
  });

  it("null fullName survives the mapping", () => {
    const profile = { fullName: null, phone: null, role: "parent" as const };
    const result = mapMeStatus(200, profile);
    if (result.ok) expect(result.profile.fullName).toBeNull();
  });
});
