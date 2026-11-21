// Unit tests for /leaderboard/summary — the SSR-nav endpoint. Covers the
// two behaviors the rest of the site depends on:
//
//   1. The summary is NOT rate-limited. The three heavy board endpoints
//      share a 60/min/IP limiter, but server-side fetches from the web
//      host all come from one outbound IP pool; if the summary shared
//      that limiter, a scraper hitting /leaderboard/club could hide the
//      Leaderboards nav for every user on a Next.js instance. This test
//      drives 70 requests from the same IP and expects them all to 200.
//
//   2. The summary is memoized for ~60s on each API instance so the three
//      board loaders don't re-run per request. With a warm cache, the
//      handler issues zero DB queries.

import { vi, describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import pino from "pino";

const { mockGetUser, mockDbSelect } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockDbSelect: vi.fn(),
}));

vi.mock("../lib/supabase", () => ({
  supabase: { auth: { getUser: mockGetUser } },
}));

vi.mock("../db/client", () => ({
  db: { select: mockDbSelect },
}));

import { createApp } from "../app";
import { clearLeaderboardSummaryCache } from "../routes/leaderboard";

const logger = pino({ level: "silent" });
const app = createApp(logger);

// A summary call kicks off three loaders in parallel. In the empty-DB
// case each loader short-circuits as soon as it sees no registrations /
// no eligible swimmers, which leaves exactly four db.select() calls:
//
//   1. club registrations          (where → empty → early return)
//   2. isl registrations           (where → empty → early return)
//   3. master standards            (from, no where)
//   4. master eligibleSwimmers     (where → empty, skips fetchPbs)
//
// The order is fixed because Promise.all fires the loaders synchronously
// before any await resolves: club → isl → master (standards + swimmers
// started in that order inside master's own Promise.all).
function emptyLoaderSequence() {
  const emptyWhere = () => ({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) });
  const emptyFrom = () => ({ from: vi.fn().mockResolvedValue([]) });
  mockDbSelect
    .mockReturnValueOnce(emptyWhere())   // club registrations
    .mockReturnValueOnce(emptyWhere())   // isl registrations
    .mockReturnValueOnce(emptyFrom())    // master standards
    .mockReturnValueOnce(emptyWhere());  // master eligibleSwimmers
}

beforeEach(() => {
  vi.clearAllMocks();
  clearLeaderboardSummaryCache();
});

describe("GET /leaderboard/summary — rate limiter", () => {
  it("is not rate-limited after the 60/min threshold the heavy boards share", async () => {
    // Prime the cache with one real call, then 70 more should hit the
    // cache and all respond 200. If the shared limiter were still in
    // front of this route, request 61 would come back 429.
    emptyLoaderSequence();
    const primer = await request(app).get("/leaderboard/summary");
    expect(primer.status).toBe(200);

    for (let index = 0; index < 70; index += 1) {
      const res = await request(app).get("/leaderboard/summary");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ qualifying: [] });
    }
  });
});

describe("GET /leaderboard/summary — in-memory cache", () => {
  it("serves subsequent calls from the memoized result without re-running the board loaders", async () => {
    emptyLoaderSequence();
    const first = await request(app).get("/leaderboard/summary");
    expect(first.status).toBe(200);
    // Primer consumed exactly the four select chains from emptyLoaderSequence.
    expect(mockDbSelect).toHaveBeenCalledTimes(4);

    // No further queue of loader mocks — if the handler ran them again
    // we'd crash on `undefined.from(...)`. The cached path proves it
    // short-circuits before touching mockDbSelect.
    const second = await request(app).get("/leaderboard/summary");
    const third = await request(app).get("/leaderboard/summary");
    expect(second.status).toBe(200);
    expect(third.status).toBe(200);
    expect(mockDbSelect).toHaveBeenCalledTimes(4);
  });

  it("recomputes after clearLeaderboardSummaryCache simulates TTL expiry", async () => {
    emptyLoaderSequence();
    const first = await request(app).get("/leaderboard/summary");
    expect(first.status).toBe(200);
    expect(mockDbSelect).toHaveBeenCalledTimes(4);

    // Blow the cache and queue a second loader sequence. The next call
    // must re-run the four selects.
    clearLeaderboardSummaryCache();
    emptyLoaderSequence();

    const second = await request(app).get("/leaderboard/summary");
    expect(second.status).toBe(200);
    expect(mockDbSelect).toHaveBeenCalledTimes(8);
  });
});
