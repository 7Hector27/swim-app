// Policy-acceptance gating on parent write routes (ADR 036 Phase 8 Part
// B Stop 3 piece 3). Covers:
//
//   POST /lessons                  — single booking
//   POST /lessons/batch            — multiple + recurring batch
//   POST /payments/checkout-session — top-ups and packages
//
// A parent whose latest accepted version is behind any tracked policy's
// current constant gets 409 `policy_acceptance_required` before any
// business logic runs. View routes (GET /me/balance, /me/balance/history)
// and the account-deletion flow are explicitly NOT gated: a parent must
// always be able to read their data and close their account. Coaches hit
// `requireParent`'s 403 first so this middleware never sees them.
//
// After a valid POST /me/policies/accept with the current versions, the
// gate clears — the same POST /lessons that returned 409 before now
// proceeds past the middleware (the handler may still 422 on body shape
// or 403 on role, but it will never return 409 again).

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import pino from "pino";
import { eq, sql } from "drizzle-orm";

import { createApp } from "../../app";
import {
  adminDb,
  clearPolicyAcceptancesForTest,
  closeAdminDb,
  createTestUser,
  type TestUser,
} from "./helpers";
import { profiles, userPolicyAcceptances } from "../../db/schema";
import {
  PAYMENTS_REFUND_VERSION,
  PRIVACY_VERSION,
  TERMS_VERSION,
  type PolicySlug,
} from "@swim-app/shared";

const app = createApp(pino({ level: "silent" }));

const createdUsers: TestUser[] = [];

async function seedAcceptance(
  userId: string,
  slug: PolicySlug,
  version: string,
): Promise<void> {
  await adminDb().insert(userPolicyAcceptances).values({
    userId,
    policySlug: slug,
    version,
    source: "signup",
  });
}

async function seedAllCurrent(userId: string): Promise<void> {
  await seedAcceptance(userId, "terms", TERMS_VERSION);
  await seedAcceptance(userId, "privacy", PRIVACY_VERSION);
  await seedAcceptance(userId, "payments_refund", PAYMENTS_REFUND_VERSION);
}

let parent: TestUser;
let coach: TestUser;

beforeAll(async () => {
  parent = await createTestUser("policy-gating-parent");
  createdUsers.push(parent);
  // The helper auto-seeds three current acceptances to match
  // production. This file tests the gate specifically — we need to
  // control the acceptance state per-test from an empty baseline.
  await clearPolicyAcceptancesForTest(parent.userId);
  coach = await createTestUser("policy-gating-coach");
  createdUsers.push(coach);
  await adminDb().update(profiles).set({ role: "coach" }).where(eq(profiles.id, coach.userId));
});

afterEach(async () => {
  // Reset the parent to "no acceptances" between tests. The append-only
  // trigger blocks DELETE in the normal path, so wrap in a transaction
  // under session_replication_role=replica (same pattern as the balance
  // ledger integration-test cleanup).
  await adminDb().transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL session_replication_role = replica`);
    await tx.execute(
      sql`DELETE FROM user_policy_acceptances WHERE user_id = ${parent.userId}::uuid`,
    );
  });
});

afterAll(async () => {
  for (const user of createdUsers) {
    await user.cleanup().catch(() => void 0);
  }
  await closeAdminDb();
});

describe("POST /lessons — policy acceptance gate", () => {
  it("returns 409 policy_acceptance_required when every policy is missing an acceptance", async () => {
    const res = await request(app)
      .post("/lessons")
      .set("Authorization", `Bearer ${parent.accessToken}`)
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("policy_acceptance_required");
    const slugs = (res.body.missing as Array<{ policySlug: string }>).map((row) => row.policySlug);
    expect(new Set(slugs)).toEqual(new Set(["terms", "privacy", "payments_refund"]));
  });

  it("returns 409 listing every stale slug, not just the first", async () => {
    // Seed terms as current, leave privacy + payments_refund missing.
    await seedAcceptance(parent.userId, "terms", TERMS_VERSION);
    // Seed payments_refund as a stale version so it appears with a
    // non-null lastAcceptedVersion in the 409 body.
    await seedAcceptance(parent.userId, "payments_refund", "1999-01-01");

    const res = await request(app)
      .post("/lessons")
      .set("Authorization", `Bearer ${parent.accessToken}`)
      .send({});
    expect(res.status).toBe(409);
    const bySlug = Object.fromEntries(
      (res.body.missing as Array<{ policySlug: string; lastAcceptedVersion: string | null }>).map(
        (row) => [row.policySlug, row],
      ),
    );
    expect(bySlug["terms"]).toBeUndefined();
    expect(bySlug["privacy"]).toMatchObject({ lastAcceptedVersion: null });
    expect(bySlug["payments_refund"]).toMatchObject({
      lastAcceptedVersion: "1999-01-01",
      currentVersion: PAYMENTS_REFUND_VERSION,
    });
  });

  it("passes the gate when every policy is current (handler may still 4xx on body shape, but never 409)", async () => {
    await seedAllCurrent(parent.userId);
    const res = await request(app)
      .post("/lessons")
      .set("Authorization", `Bearer ${parent.accessToken}`)
      .send({});
    // The middleware is cleared. The handler still rejects the empty
    // body with a 422 (missing fields) — anything but 409 proves the
    // gate let the request through.
    expect(res.status).not.toBe(409);
  });
});

describe("POST /lessons/batch — policy acceptance gate", () => {
  it("returns 409 when stale", async () => {
    const res = await request(app)
      .post("/lessons/batch")
      .set("Authorization", `Bearer ${parent.accessToken}`)
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("policy_acceptance_required");
  });

  it("passes the gate when current", async () => {
    await seedAllCurrent(parent.userId);
    const res = await request(app)
      .post("/lessons/batch")
      .set("Authorization", `Bearer ${parent.accessToken}`)
      .send({});
    expect(res.status).not.toBe(409);
  });
});

describe("POST /payments/checkout-session — policy acceptance gate", () => {
  it("returns 409 when stale", async () => {
    const res = await request(app)
      .post("/payments/checkout-session")
      .set("Authorization", `Bearer ${parent.accessToken}`)
      .send({ kind: "topup", lessonTopup: { durationMinutes: 30, swimmerCount: 1 } });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("policy_acceptance_required");
  });

  it("passes the gate when current", async () => {
    await seedAllCurrent(parent.userId);
    const res = await request(app)
      .post("/payments/checkout-session")
      .set("Authorization", `Bearer ${parent.accessToken}`)
      .send({ kind: "topup", lessonTopup: { durationMinutes: 30, swimmerCount: 1 } });
    // Any non-409 outcome proves the gate cleared. In test mode this
    // may be 2xx (Stripe stub) or 4xx for a downstream reason, but
    // never 409.
    expect(res.status).not.toBe(409);
  });
});

describe("read-only + deletion routes are NOT gated", () => {
  it("GET /me/balance is reachable with no acceptances", async () => {
    const res = await request(app)
      .get("/me/balance")
      .set("Authorization", `Bearer ${parent.accessToken}`);
    // Without any acceptances the gate would fire 409 if it were
    // attached. A view route returns 200 or a non-409 error.
    expect(res.status).not.toBe(409);
  });

  it("GET /me/balance/history is reachable with no acceptances", async () => {
    const res = await request(app)
      .get("/me/balance/history")
      .set("Authorization", `Bearer ${parent.accessToken}`);
    expect(res.status).not.toBe(409);
  });

  it("POST /me/deletion/preview is reachable with no acceptances", async () => {
    const res = await request(app)
      .post("/me/deletion/preview")
      .set("Authorization", `Bearer ${parent.accessToken}`)
      .send({});
    // Preview may return 200 or a non-409 error depending on fixture
    // state. Only the gate return 409; any other outcome proves it's
    // not firing on the deletion path.
    expect(res.status).not.toBe(409);
  });
});

describe("accepting clears the gate", () => {
  it("POST /me/policies/accept with current versions removes the 409 on the next POST /lessons", async () => {
    // First call blocked.
    const before = await request(app)
      .post("/lessons")
      .set("Authorization", `Bearer ${parent.accessToken}`)
      .send({});
    expect(before.status).toBe(409);

    // Accept all three.
    const accept = await request(app)
      .post("/me/policies/accept")
      .set("Authorization", `Bearer ${parent.accessToken}`)
      .send({
        acceptances: [
          { policySlug: "terms", version: TERMS_VERSION },
          { policySlug: "privacy", version: PRIVACY_VERSION },
          { policySlug: "payments_refund", version: PAYMENTS_REFUND_VERSION },
        ],
      });
    expect(accept.status).toBe(201);

    // Same request now clears the gate.
    const after = await request(app)
      .post("/lessons")
      .set("Authorization", `Bearer ${parent.accessToken}`)
      .send({});
    expect(after.status).not.toBe(409);
  });
});

describe("coach never sees the 409", () => {
  it("coach hitting POST /lessons gets requireParent's 403, never 409", async () => {
    // The coach has no acceptances — if the gate ran first it would
    // 409. requireParent runs earlier in the chain and rejects the
    // non-parent role with 403.
    const res = await request(app)
      .post("/lessons")
      .set("Authorization", `Bearer ${coach.accessToken}`)
      .send({});
    expect(res.status).toBe(403);
  });
});
