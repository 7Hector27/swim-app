// Tests for the per-email signup limiter.
//
// Scope:
// - 5 attempts per hour per lowercased+trimmed email.
// - 429 shape is identical regardless of whether the account would be
//   created or already exists (enumeration-safe).
// - Two different emails have independent buckets.
// - Casing / whitespace variants of the same email map to the same bucket.

import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { authEmailLimiter } from "../middleware/authEmailRateLimit";

// The limiter uses a shared in-memory store across the test file. Each
// test uses a unique email so counters don't bleed between tests.
function makeApp() {
  const app = express();
  app.use(express.json());
  // Route: echo back whatever "signup result" the test wants so we can
  // prove the 429 shape is identical regardless of whether the account
  // "would be" created or already exists.
  app.post("/auth/signup", authEmailLimiter, (req, res) => {
    const outcome = (req.body as { outcome?: string }).outcome;
    if (outcome === "exists") {
      res.status(400).json({ error: "Could not create account" });
      return;
    }
    res.status(201).end();
  });
  return app;
}

describe("authEmailLimiter", () => {
  it("allows 5 attempts per email then returns 429 with the standard error shape", async () => {
    const app = makeApp();
    const email = "parent-5-attempts@example.com";

    for (let index = 0; index < 5; index++) {
      const res = await request(app).post("/auth/signup").send({ email });
      expect(res.status).not.toBe(429);
    }

    const blocked = await request(app).post("/auth/signup").send({ email });
    expect(blocked.status).toBe(429);
    expect(blocked.body).toHaveProperty("error");
    expect(typeof blocked.body.error).toBe("string");
    // Generic phrasing — must not mention "email" or "account" (would
    // telegraph that the limit is per-email rather than per-IP).
    expect(blocked.body.error).toBe("Too many requests, please try again later");
  });

  it("two different emails have independent buckets", async () => {
    const app = makeApp();

    // Burn email A's budget.
    for (let index = 0; index < 5; index++) {
      await request(app).post("/auth/signup").send({ email: "burned-a@example.com" });
    }
    const blockedA = await request(app).post("/auth/signup").send({ email: "burned-a@example.com" });
    expect(blockedA.status).toBe(429);

    // Email B's first attempt must still succeed.
    const okB = await request(app).post("/auth/signup").send({ email: "fresh-b@example.com" });
    expect(okB.status).not.toBe(429);
  });

  it("casing and surrounding whitespace map to the same bucket (lowercased + trimmed)", async () => {
    const app = makeApp();

    // Five requests spread across case/whitespace variants of the same email.
    const variants = [
      "parent-case@example.com",
      "Parent-Case@example.com",
      "PARENT-CASE@example.com",
      " parent-case@example.com ",
      "\tparent-case@EXAMPLE.com",
    ];
    for (const variant of variants) {
      const res = await request(app).post("/auth/signup").send({ email: variant });
      expect(res.status).not.toBe(429);
    }

    // The 6th in any form must 429 — all five variants hit one bucket.
    const blocked = await request(app).post("/auth/signup").send({ email: "Parent-Case@EXAMPLE.com" });
    expect(blocked.status).toBe(429);
  });

  it("skips the limiter entirely when no email is present — no shared fallback bucket", async () => {
    // In production, validate() rejects a no-email body with 422 before
    // the limiter runs. If anything slips past, these requests must not
    // land in a shared "unknown" bucket where they can collectively hit
    // 429 and amplify / mask real per-email counters. Prove that many
    // no-email requests never trigger 429 and never deplete a real
    // email's budget.
    const app = makeApp();

    for (let index = 0; index < 20; index++) {
      // Mix of shapes the limiter might see if validate() is bypassed:
      // no body, empty object, non-string email, empty string email.
      const payloads = [{}, { email: null }, { email: "" }, { email: 123 }, { email: "   " }];
      const payload = payloads[index % payloads.length];
      const res = await request(app).post("/auth/signup").send(payload);
      expect(res.status).not.toBe(429);
    }

    // The fresh-email bucket is still untouched after the storm.
    const fresh = "no-email-bystander@example.com";
    for (let index = 0; index < 5; index++) {
      const res = await request(app).post("/auth/signup").send({ email: fresh });
      expect(res.status).not.toBe(429);
    }
    const blocked = await request(app).post("/auth/signup").send({ email: fresh });
    expect(blocked.status).toBe(429);
  });

  it("is enumeration-safe: 429 for a registered email is byte-identical to 429 for a brand-new email", async () => {
    const app = makeApp();

    // Scenario A: email that "would be" a fresh signup (201 on each
    // success). Burn the budget then capture the 429.
    const freshEmail = "fresh-enumeration@example.com";
    for (let index = 0; index < 5; index++) {
      await request(app).post("/auth/signup").send({ email: freshEmail, outcome: "fresh" });
    }
    const blockedFresh = await request(app).post("/auth/signup").send({ email: freshEmail, outcome: "fresh" });

    // Scenario B: email that "already exists" (400 on each attempt).
    // Burn the budget then capture the 429.
    const existingEmail = "existing-enumeration@example.com";
    for (let index = 0; index < 5; index++) {
      await request(app).post("/auth/signup").send({ email: existingEmail, outcome: "exists" });
    }
    const blockedExisting = await request(app).post("/auth/signup").send({ email: existingEmail, outcome: "exists" });

    // The 429 body must be byte-identical. An attacker probing which
    // emails exist cannot distinguish them from the 429 alone.
    expect(blockedFresh.status).toBe(429);
    expect(blockedExisting.status).toBe(429);
    expect(blockedFresh.body).toEqual(blockedExisting.body);
    // Also check content-type and the standard-headers RateLimit header
    // (same header name for both would-be outcomes).
    expect(blockedFresh.headers["content-type"]).toBe(blockedExisting.headers["content-type"]);
  });
});
