import { vi, describe, expect, it } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { mapMeStatus } from "../lib/api/me";

const validProfile = { email: "jane@example.com", fullName: "Jane Doe", phone: null, role: "parent" as const };
const coachProfile = { email: "jason@example.com", fullName: "Jason G", phone: null, role: "coach" as const };

describe("mapMeStatus", () => {
  it("200 with body → ok with profile", () => {
    expect(mapMeStatus(200, validProfile)).toEqual({ ok: true, profile: validProfile });
  });

  it("200 with invalid body → not ok with status 502", () => {
    expect(mapMeStatus(200, { fullName: "No Email" })).toEqual({ ok: false, status: 502 });
  });

  it("401 → not ok with status 401", () => {
    expect(mapMeStatus(401, null)).toEqual({ ok: false, status: 401 });
  });

  it("403 with { error: 'Forbidden' } → not ok with status 403 and errorCode 'Forbidden'", () => {
    expect(mapMeStatus(403, { error: "Forbidden" })).toEqual({
      ok: false,
      status: 403,
      errorCode: "Forbidden",
    });
  });

  it("403 with { error: 'email_not_confirmed' } → errorCode 'email_not_confirmed'", () => {
    // The requireUser gate added for audit item 10. requireAuth reads
    // errorCode to route to /auth/confirm-pending instead of the
    // generic null-return.
    expect(mapMeStatus(403, { error: "email_not_confirmed" })).toEqual({
      ok: false,
      status: 403,
      errorCode: "email_not_confirmed",
    });
  });

  it("403 with no body → status 403, no errorCode", () => {
    // Fallback when the API responds 403 without the JSON shape (proxy
    // error page, empty body on a disabled-account race, etc.).
    expect(mapMeStatus(403, null)).toEqual({ ok: false, status: 403 });
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
    const profile = { email: "a@b.com", fullName: null, phone: null, role: "parent" as const };
    const result = mapMeStatus(200, profile);
    if (result.ok) expect(result.profile.fullName).toBeNull();
  });
});
