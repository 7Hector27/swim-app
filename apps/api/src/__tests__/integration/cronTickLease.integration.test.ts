// Cron tick single-writer lease integration tests (item 6 of the
// 2026-11-03 audit). Verifies that two overlapping POST /internal/cron/tick
// calls can't both run, and that an expired lease is taken over on the
// next tick.

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import pino from "pino";
import { eq } from "drizzle-orm";

import { createApp } from "../../app";
import { adminDb, closeAdminDb } from "./helpers";
import { cronLeases } from "../../db/schema";

// The cron tick kicks off microtask-backed sync passes and drains that
// we don't want to execute during this test. Stub the services it calls.
vi.mock("../../services/googleCalendarSync", () => ({
  syncLessonToGoogle: vi.fn().mockResolvedValue(undefined),
  runFullSyncPass: vi.fn().mockResolvedValue(undefined),
  runLightSyncPass: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../services/emails/sender", () => ({
  sendLessonEmailOutboxRow: vi.fn().mockResolvedValue(undefined),
  redactEmails: (input: string) => input,
}));
vi.mock("../../services/emails/drain", () => ({
  drainLessonEmailOutbox: vi.fn().mockResolvedValue({ drained: 0, abandoned: 0 }),
  scrubLessonEmailPayloads: vi.fn().mockResolvedValue({ scrubbed: 0 }),
}));
vi.mock("../../services/notifications/drain", () => ({
  releaseHeldCoachNotifications: vi.fn().mockResolvedValue({
    releasedToPending: 0,
    releasedToSummarized: 0,
  }),
  enqueueExpiringRequestReminders: vi.fn().mockResolvedValue({ enqueued: 0 }),
  composeDailyCoachSummary: vi.fn().mockResolvedValue({ inserted: 0 }),
  drainCoachNotifications: vi.fn().mockResolvedValue({ drained: 0, abandoned: 0 }),
  scrubCoachNotificationPayloads: vi.fn().mockResolvedValue({
    scrubbed: 0,
    deadSubscriptionsPurged: 0,
  }),
}));

const logger = pino({ level: "silent" });
const app = createApp(logger);
// setup.ts sets CRON_SECRET; this fallback matches its default so the
// test still passes in a shell that already had something else set.
const cronSecret =
  process.env["CRON_SECRET"] ?? "test-cron-secret-aaaaaaaaaaaaaaaaaa";

async function clearLease(): Promise<void> {
  await adminDb().delete(cronLeases).where(eq(cronLeases.name, "cron/tick"));
}

afterAll(async () => {
  await clearLease();
  await closeAdminDb();
});

describe("POST /internal/cron/tick — single-writer lease", () => {
  beforeEach(async () => {
    await clearLease();
  });

  it("when two ticks run concurrently, one wins and the other returns 200 { skipped: true }", async () => {
    // Fire both ticks in parallel. The route acquires the lease at the
    // top of its handler; the first INSERT ... ON CONFLICT lands first
    // by DB serialization, the second finds a non-expired lease and
    // short-circuits.
    const [first, second] = await Promise.all([
      request(app).post("/internal/cron/tick").set("cron-secret", cronSecret),
      request(app).post("/internal/cron/tick").set("cron-secret", cronSecret),
    ]);

    const statuses = [first.status, second.status];
    expect(statuses).toEqual([200, 200]);

    // Exactly one of the two bodies should be the skip shape.
    const skippedCount = [first.body, second.body].filter(
      (body) => body?.skipped === true,
    ).length;
    const ranCount = [first.body, second.body].filter(
      (body) => typeof body?.expired === "number",
    ).length;
    expect(skippedCount).toBe(1);
    expect(ranCount).toBe(1);
  });

  it("takes over an expired lease on the next tick", async () => {
    // Seed a lease whose held_until is in the past, simulating a crashed
    // holder that never cleared it.
    const longAgo = new Date(Date.now() - 60 * 60 * 1000);
    await adminDb().insert(cronLeases).values({
      name: "cron/tick",
      heldUntil: longAgo,
      heldBy: "stale-holder",
    });

    const res = await request(app)
      .post("/internal/cron/tick")
      .set("cron-secret", cronSecret);

    expect(res.status).toBe(200);
    // The tick actually ran — not skipped.
    expect(res.body.skipped).toBeUndefined();
    expect(typeof res.body.expired).toBe("number");

    // After the run, the handler releases the lease (held_until=null).
    const rows = await adminDb()
      .select({ heldUntil: cronLeases.heldUntil, heldBy: cronLeases.heldBy })
      .from(cronLeases)
      .where(eq(cronLeases.name, "cron/tick"));
    expect(rows[0]?.heldUntil).toBeNull();
    expect(rows[0]?.heldBy).toBeNull();
  });
});
