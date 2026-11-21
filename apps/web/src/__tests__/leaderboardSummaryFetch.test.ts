// Tests for the fetchLeaderboardSummary helper. The root layout uses the
// returned value to decide whether to show Leaderboards nav links, so
// the two guarantees it must preserve are:
//
//   1. The helper opts into Next's Data Cache with revalidate: 60. Each
//      Next.js instance then hits the API at most once per minute for
//      this URL — prevents the web host's outbound IP pool from eating
//      the API's public rate limit.
//
//   2. Failure fails safe. Network error, non-200, or malformed body all
//      resolve to `null` (not a throw). The layout turns `null` into
//      hasAnyBoard = false → nav links hidden, page still renders. A
//      rate-limited or down summary must not take the whole site with it.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchLeaderboardSummary } from "../lib/api/leaderboard";

const originalFetch = globalThis.fetch;
const originalApiUrl = process.env.NEXT_PUBLIC_API_URL;

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = "http://api.test";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiUrl === undefined) {
    delete process.env.NEXT_PUBLIC_API_URL;
  } else {
    process.env.NEXT_PUBLIC_API_URL = originalApiUrl;
  }
  vi.restoreAllMocks();
});

describe("fetchLeaderboardSummary — Next Data Cache opt-in", () => {
  it("passes { next: { revalidate: 60 } } so Next caches the response for 60s across renders", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ qualifying: [] }),
    });
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;

    await fetchLeaderboardSummary();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0]!;
    expect(init).toEqual(expect.objectContaining({ next: { revalidate: 60 } }));
  });
});

describe("fetchLeaderboardSummary — fail-safe", () => {
  it("returns null on a 429 so the layout hides the nav links but still renders", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 429, json: async () => ({ error: "Too many" }) }) as unknown as typeof globalThis.fetch;

    const result = await fetchLeaderboardSummary();
    expect(result).toBeNull();
  });

  it("returns null on a thrown network error (not propagated)", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error("ECONNRESET")) as unknown as typeof globalThis.fetch;

    const result = await fetchLeaderboardSummary();
    expect(result).toBeNull();
  });

  it("returns null when the API returns 200 with a body that doesn't parse against the schema", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ qualifying: ["not-a-real-board"] }),
    }) as unknown as typeof globalThis.fetch;

    const result = await fetchLeaderboardSummary();
    expect(result).toBeNull();
  });
});
