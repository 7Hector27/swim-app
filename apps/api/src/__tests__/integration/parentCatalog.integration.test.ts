// Tests for GET /parent/categories.
//
// The parent progress page used to fetch /coach/categories, which 403s for
// anyone without the coach role — the page then rendered "Couldn't load
// skill categories." This route is the parent-safe mirror: same catalog
// shape, no faultTags on skills.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import request from "supertest";
import pino from "pino";
import { createApp } from "../../app";
import {
  adminDb,
  closeAdminDb,
  createTestUser,
} from "./helpers";
import type { TestUser } from "./helpers";
import { profiles } from "../../db/schema";
import syncCatalogFn from "../../db/scripts/syncCatalogFn";

const logger = pino({ level: "silent" });
const app = createApp(logger);

let parent: TestUser;
let coach: TestUser;

beforeAll(async () => {
  await syncCatalogFn(adminDb());
  parent = await createTestUser("parent-cat");
  coach = await createTestUser("parent-cat-coach");
  await adminDb().update(profiles).set({ role: "coach" }).where(eq(profiles.id, coach.userId));
});

afterAll(async () => {
  await coach.cleanup();
  await parent.cleanup();
  await closeAdminDb();
});

describe("GET /parent/categories", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(app).get("/parent/categories");
    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller is a coach (coaches should use /coach/categories)", async () => {
    const res = await request(app)
      .get("/parent/categories")
      .set("Authorization", `Bearer ${coach.accessToken}`);
    expect(res.status).toBe(403);
  });

  it("returns 200 with the catalog for a parent", async () => {
    const res = await request(app)
      .get("/parent/categories")
      .set("Authorization", `Bearer ${parent.accessToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);

    const freestyle = (res.body as Array<{ slug: string }>).find((cat) => cat.slug === "freestyle");
    expect(freestyle, "freestyle category should be in the response").toBeDefined();
  });

  it("every skill in the response omits faultTags (parents never see fault tags)", async () => {
    const res = await request(app)
      .get("/parent/categories")
      .set("Authorization", `Bearer ${parent.accessToken}`);
    expect(res.status).toBe(200);
    for (const category of res.body as Array<{ skills: Array<Record<string, unknown>> }>) {
      for (const skill of category.skills) {
        expect(skill).not.toHaveProperty("faultTags");
      }
    }
  });
});
