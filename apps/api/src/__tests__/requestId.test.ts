import { describe, it, expect } from "vitest";
import request from "supertest";
import pino from "pino";
import { createApp } from "../app";

const logger = pino({ level: "silent" });
const app = createApp(logger);

describe("x-request-id header", () => {
  it("generates a UUID when no header is provided", async () => {
    const res = await request(app).get("/ping");
    expect(res.headers["x-request-id"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("reuses the incoming x-request-id header", async () => {
    const id = "my-trace-id-abc123";
    const res = await request(app).get("/ping").set("x-request-id", id);
    expect(res.headers["x-request-id"]).toBe(id);
  });

  it("different requests get different generated IDs", async () => {
    const [a, b] = await Promise.all([
      request(app).get("/ping"),
      request(app).get("/ping"),
    ]);
    expect(a.headers["x-request-id"]).not.toBe(b.headers["x-request-id"]);
  });
});
