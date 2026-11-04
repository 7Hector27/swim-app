// Unit test for the booking rate limiter. Mounts the limiter on a bare
// Express app behind a fake auth middleware that sets req.profile, so we
// can prove: (a) the limiter keys on profile.id (two users share no
// budget), (b) 429 uses the standard { error } shape.

import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { bookingLimiter } from "../middleware/bookingRateLimit";

function makeApp(profileId: string) {
  const app = express();
  app.use((req, _res, next) => {
    (req as unknown as { profile: { id: string } }).profile = { id: profileId };
    next();
  });
  app.post("/book", bookingLimiter, (_req, res) => res.status(201).json({ ok: true }));
  return app;
}

describe("bookingLimiter", () => {
  it("allows up to 60 requests per user per hour, then returns 429 with standard error shape", async () => {
    const app = makeApp("user-a");

    for (let index = 0; index < 60; index++) {
      const res = await request(app).post("/book");
      expect(res.status).toBe(201);
    }

    const blocked = await request(app).post("/book");
    expect(blocked.status).toBe(429);
    expect(blocked.body).toHaveProperty("error");
    expect(typeof blocked.body.error).toBe("string");
    // Must be the standard shape — NOT html, not raw text, not 500.
    expect(blocked.body.error).toContain("Too many booking requests");
    // RateLimit draft-7 headers should be present on 429 responses.
    // draft-7 exposes a single combined `ratelimit` header plus policy.
    expect(blocked.headers["ratelimit"] ?? blocked.headers["ratelimit-policy"]).toBeDefined();
  });

  it("keys on profile.id, so two different users do not share a budget", async () => {
    const appA = makeApp("user-a2");
    const appB = makeApp("user-b2");

    // Burn user A's budget.
    for (let index = 0; index < 60; index++) {
      await request(appA).post("/book");
    }
    const blockedA = await request(appA).post("/book");
    expect(blockedA.status).toBe(429);

    // User B's first request must still succeed.
    const okB = await request(appB).post("/book");
    expect(okB.status).toBe(201);
  });
});
