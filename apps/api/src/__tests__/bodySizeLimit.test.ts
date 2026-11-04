import { describe, it, expect } from "vitest";
import request from "supertest";
import pino from "pino";
import { createApp } from "../app";

const logger = pino({ level: "silent" });
const app = createApp(logger);

describe("body size limit", () => {
  it("returns a clean 413 with the standard error shape for an oversized JSON body", async () => {
    // 128 KB — well over the 64 KB limit.
    const oversized = { pad: "x".repeat(128 * 1024) };
    const res = await request(app)
      .post("/auth/signup")
      .set("content-type", "application/json")
      .send(oversized);

    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: "Request body too large" });
    // Must not be the generic 500 shape.
    expect(res.body.error).not.toBe("Internal server error");
  });

  it("accepts a reasonable body (passes limit, fails downstream validation only)", async () => {
    const body = { email: "a@b.co", password: "pw", fullName: "T T", birthDate: "2000-01-01" };
    const res = await request(app)
      .post("/auth/signup")
      .set("content-type", "application/json")
      .send(body);

    // Should NOT be 413 — we care that the size gate passed. Downstream
    // validation / DB can fail with any other status.
    expect(res.status).not.toBe(413);
  });
});
