import express from "express";
import pino from "pino";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { failRoutes, matchesFailPattern } from "../middleware/failRoutes";

const logger = pino({ level: "silent" });

function makeApp(patterns: readonly string[]): express.Express {
  const app = express();
  // Stand in for pino-http's child logger so the middleware can call
  // req.log.warn without needing the full createApp pipeline.
  app.use((req, _res, next) => {
    (req as express.Request & { log: pino.Logger }).log = logger;
    next();
  });
  app.use(failRoutes(patterns));
  app.get("/clubs", (_req, res) => {
    res.json({ ok: true });
  });
  app.get("/clubs/:id", (_req, res) => {
    res.json({ ok: true });
  });
  app.get("/lessons", (_req, res) => {
    res.json({ ok: true });
  });
  app.get("/lessons/:id", (_req, res) => {
    res.json({ ok: true });
  });
  app.get("/healthy", (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

describe("matchesFailPattern", () => {
  it("matches an exact path", () => {
    expect(matchesFailPattern("/clubs", "/clubs")).toBe(true);
  });

  it("does not match a nested path for an exact pattern", () => {
    expect(matchesFailPattern("/clubs/42", "/clubs")).toBe(false);
  });

  it("treats a trailing * as a prefix match", () => {
    expect(matchesFailPattern("/lessons", "/lessons*")).toBe(true);
    expect(matchesFailPattern("/lessons/42", "/lessons*")).toBe(true);
    expect(matchesFailPattern("/lessons/42/notes", "/lessons*")).toBe(true);
  });

  it("does not match unrelated paths under a trailing *", () => {
    expect(matchesFailPattern("/meets", "/lessons*")).toBe(false);
  });

  it("requires the separator when the pattern has /*", () => {
    expect(matchesFailPattern("/lessons", "/lessons/*")).toBe(false);
    expect(matchesFailPattern("/lessons/42", "/lessons/*")).toBe(true);
  });
});

describe("failRoutes middleware", () => {
  it("returns 500 with the standard error shape on an exact match", async () => {
    const app = makeApp(["/clubs"]);
    const res = await request(app).get("/clubs");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Internal server error" });
  });

  it("returns 500 on a wildcard-prefix match", async () => {
    const app = makeApp(["/lessons*"]);
    const res = await request(app).get("/lessons/42");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Internal server error" });
  });

  it("passes non-matching requests through to the handler", async () => {
    const app = makeApp(["/clubs"]);
    const res = await request(app).get("/healthy");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("treats an exact pattern as exact (sibling paths unaffected)", async () => {
    const app = makeApp(["/clubs"]);
    const res = await request(app).get("/clubs/42");
    expect(res.status).toBe(200);
  });

  it("is a no-op when the patterns list is empty", async () => {
    const app = makeApp([]);
    const res = await request(app).get("/clubs");
    expect(res.status).toBe(200);
  });

  it("matches on the first configured pattern that applies", async () => {
    const app = makeApp(["/healthy", "/lessons*"]);
    const res = await request(app).get("/lessons/99");
    expect(res.status).toBe(500);
  });
});
