// fetchHousehold must distinguish "parent isn't in a household yet"
// (legit null) from "the load failed" (error). Pages that redirect to
// onboarding or show a create-household flow must only fire on the null
// branch — a 5xx must surface through the error branch, otherwise a
// broken server looks like an unenrolled parent.

import { vi, describe, it, expect, beforeEach } from "vitest";

import { fetchHousehold } from "../lib/api/households";

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

beforeEach(() => {
  mockFetch.mockReset();
});

describe("fetchHousehold", () => {
  it("returns { ok: true, household: <data> } on 200", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        name: "Smith",
        myRole: "owner",
        members: [],
        swimmerIds: [],
      }),
    });
    const result = await fetchHousehold("token");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.household).not.toBeNull();
      expect(result.household?.myRole).toBe("owner");
    }
  });

  it("returns { ok: true, household: null } on 403 (parent not in a household yet)", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: "Forbidden" }),
    });
    const result = await fetchHousehold("token");
    expect(result).toEqual({ ok: true, household: null });
  });

  it("returns { ok: true, household: null } on 404 (household record missing)", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: "Not found" }),
    });
    const result = await fetchHousehold("token");
    expect(result).toEqual({ ok: true, household: null });
  });

  it("returns { ok: false, status: 500 } on a 5xx — distinct from the no-household state", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "Internal server error" }),
    });
    const result = await fetchHousehold("token");
    expect(result).toEqual({ ok: false, status: 500 });
  });

  it("returns { ok: false, status: 0 } on a network error", async () => {
    mockFetch.mockRejectedValue(new Error("network"));
    const result = await fetchHousehold("token");
    expect(result).toEqual({ ok: false, status: 0 });
  });

  it("returns { ok: false, status: 500 } on a schema mismatch", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ garbage: true }),
    });
    const result = await fetchHousehold("token");
    expect(result).toEqual({ ok: false, status: 500 });
  });
});
