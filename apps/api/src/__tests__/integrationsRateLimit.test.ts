// Verifies that /integrations/* is rate-limited. The limiter is mounted
// on the integrationsGoogleRouter and runs before any route handler, so
// it defends both /integrations/google/callback (public, hit by Google
// redirect) and /integrations/google/start (coach-authenticated but
// still per-IP amplifiable). Mirrors the leaderboard rate-limit test's
// pattern — fresh app per test so earlier tests don't consume the
// window budget.

import { describe, expect, it } from "vitest";
import pino from "pino";
import request from "supertest";

import { createApp } from "../app";

describe("GET /integrations/google/callback — rate limiting", () => {
  it("returns 429 after exceeding 60 requests per minute", async () => {
    const freshApp = createApp(pino({ level: "silent" }));

    let lastStatus = 0;
    for (let index = 0; index < 61; index++) {
      // Query is invalid — the handler would redirect with ?google=error —
      // but the limiter runs before validation. Only the status matters.
      const res = await request(freshApp).get("/integrations/google/callback");
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});
