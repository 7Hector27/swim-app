// Stripe integration tests (ADR 036 Phase 3).
//
// Stripe is mocked at the service boundary (__setStripeClientForTests). We
// never call stripe.com — the stub implements the two methods the service
// touches (`checkout.sessions.create`, `checkout.sessions.retrieve`) and
// the one webhook verifier (`webhooks.constructEvent`). The tests exercise
// the real DB + the real Express app + the real pricing module; only the
// Stripe boundary is replaced.
//
// Each scenario maps to a Stripe-side risk ADR 036 §3 commits to defending:
//
//   1. Signature failure → 400, no ledger insert, no stripe_events row.
//   2. Browser cannot pass an amount — Zod `.strict()` rejects unknown
//      keys on POST /payments/checkout-session.
//   3. Browser cannot pass a household id — the id used by the webhook
//      path comes from the auth session, never the body.
//   4. Replay of the same stripe_event_id → one credit (Layer 1 dedup).
//   5. A different event for the same checkout_session_id → still one
//      credit (Layer 2 DB-level UNIQUE on
//      balance_ledger_stripe_session_uq).
//   6. Metadata-tampered amount → 200 but no credit, warn logged.
//   7. The success redirect route does not exist at /webhooks/stripe —
//      the only path that writes to the ledger is the signed webhook,
//      and a request without a signature is rejected.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import pino from "pino";
import { and, eq, sql } from "drizzle-orm";
import type Stripe from "stripe";

import { createApp } from "../../app";
import {
  adminDb,
  closeAdminDb,
  createTestUser,
  type TestUser,
} from "./helpers";
import {
  householdAuditLog,
  householdBalanceLedger,
  stripeEvents,
} from "../../db/schema";
import { priceForLesson, packagePrice } from "@swim-app/shared";
import {
  __setStripeClientForTests,
  type StripeAdapter,
} from "../../services/stripe";

// ── Stripe test double ───────────────────────────────────────────────────────
// setup.ts seeds STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET so env.stripe
// is non-null when createApp() parses env at import-chain time. The real
// Stripe client never runs — __setStripeClientForTests injects the stub.

// Minimal state the stub carries between create/retrieve calls. Each test
// seeds a session via the `seedSession` helper so the webhook handler's
// retrieve() returns the exact amount/metadata the test needs to exercise.
interface SeededSession {
  id: string;
  amount_total: number;
  metadata: Record<string, string>;
  payment_intent: string | null;
}

const seededSessions = new Map<string, SeededSession>();

function seedSession(session: SeededSession): void {
  seededSessions.set(session.id, session);
}

function clearSeededSessions(): void {
  seededSessions.clear();
}

type ConstructEventFn = StripeAdapter["webhooks"]["constructEvent"];
type RetrieveFn = StripeAdapter["checkout"]["sessions"]["retrieve"];
type CreateFn = StripeAdapter["checkout"]["sessions"]["create"];

// Build a Stripe.Event body shape the webhook handler consumes. Real Stripe
// signs the exact bytes; our stub just parses the JSON body and treats the
// signature as a shared secret marker — verifier below matches
// `sig === "sig:<eventId>"` and rejects everything else.
function jsonBody(obj: unknown): string {
  return JSON.stringify(obj);
}

function constructEvent(rawBody: string | Buffer, signature: unknown): Stripe.Event {
  const parsed = JSON.parse(typeof rawBody === "string" ? rawBody : rawBody.toString("utf8"));
  // Signature contract for the stub: `sig:<eventId>`. Anything else throws
  // — the real Stripe SDK throws here too on invalid signatures.
  if (typeof signature !== "string" || signature !== `sig:${parsed.id}`) {
    throw new Error("stub: signature mismatch");
  }
  return parsed as Stripe.Event;
}

function makeStubStripe(): StripeAdapter {
  const constructEventStub = vi.fn(((rawBody, sig) =>
    constructEvent(rawBody as string | Buffer, sig)) as ConstructEventFn);
  const retrieveStub = vi.fn((async (id) => {
    const session = seededSessions.get(id as string);
    if (!session) throw new Error(`stub: session ${String(id)} not seeded`);
    return {
      id: session.id,
      amount_total: session.amount_total,
      metadata: session.metadata,
      payment_intent: session.payment_intent,
      // Fields the service reads but doesn't branch on; empty values keep
      // the types happy.
      currency: "usd",
      object: "checkout.session",
    } as unknown as Stripe.Response<Stripe.Checkout.Session>;
  }) as RetrieveFn);

  // Each checkout.sessions.create call returns a deterministic id derived
  // from the amount + metadata so tests can look it up by shape later. The
  // route uses the id + url only.
  let counter = 0;
  const createStub = vi.fn((async (params) => {
    counter += 1;
    const id = `cs_test_stub_${counter}_${Math.random().toString(36).slice(2, 8)}`;
    return {
      id,
      url: `https://checkout.stripe.test/${id}`,
      amount_total: params?.line_items?.[0]?.price_data?.unit_amount ?? 0,
      metadata: (params?.metadata ?? {}) as Record<string, string>,
    } as unknown as Stripe.Response<Stripe.Checkout.Session>;
  }) as CreateFn);

  return {
    checkout: { sessions: { create: createStub, retrieve: retrieveStub } },
    webhooks: { constructEvent: constructEventStub },
  };
}

// ── App ──────────────────────────────────────────────────────────────────────

const app = createApp(pino({ level: "silent" }));
let owner: TestUser;

async function makeEventId(prefix: string): Promise<string> {
  return `evt_test_${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

async function makeSessionId(prefix: string): Promise<string> {
  return `cs_test_${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function completedEvent(args: {
  eventId: string;
  session: SeededSession;
}): Stripe.Event {
  return {
    id: args.eventId,
    type: "checkout.session.completed",
    api_version: "2024-06-20",
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: args.session.id,
        amount_total: args.session.amount_total,
        metadata: args.session.metadata,
        payment_intent: args.session.payment_intent,
        object: "checkout.session",
      } as unknown as Stripe.Checkout.Session,
    },
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    object: "event",
  } as unknown as Stripe.Event;
}

beforeAll(async () => {
  owner = await createTestUser("stripe-owner");
  __setStripeClientForTests(makeStubStripe());
});

afterEach(async () => {
  clearSeededSessions();

  // Clean the ledger + audit + stripe_events for this household between
  // tests so the balance starts at $0 every time. The append-only trigger
  // blocks a plain DELETE, so bypass it with session_replication_role.
  await adminDb().transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL session_replication_role = replica`);
    await tx.execute(
      sql`DELETE FROM household_balance_ledger WHERE household_id = ${owner.householdId}::uuid`,
    );
  });
  await adminDb()
    .delete(householdAuditLog)
    .where(eq(householdAuditLog.householdId, owner.householdId));
  await adminDb().delete(stripeEvents);
});

afterAll(async () => {
  __setStripeClientForTests(undefined);
  await owner.cleanup();
  await closeAdminDb();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("POST /webhooks/stripe", () => {
  it("rejects a request with an invalid signature with 400 and writes no ledger row", async () => {
    const sessionId = await makeSessionId("bad-sig");
    const eventId = await makeEventId("bad-sig");
    const session: SeededSession = {
      id: sessionId,
      amount_total: priceForLesson(30, 1),
      metadata: {
        kind: "topup",
        householdId: owner.householdId,
        actorId: owner.userId,
        durationMinutes: "30",
        swimmerCount: "1",
      },
      payment_intent: "pi_test_badsig",
    };
    seedSession(session);
    const event = completedEvent({ eventId, session });

    const res = await request(app)
      .post("/webhooks/stripe")
      .set("Stripe-Signature", "this-is-not-the-right-signature")
      .set("Content-Type", "application/json")
      .send(jsonBody(event));

    expect(res.status).toBe(400);

    const ledgerRows = await adminDb()
      .select({ id: householdBalanceLedger.id })
      .from(householdBalanceLedger)
      .where(eq(householdBalanceLedger.householdId, owner.householdId));
    expect(ledgerRows).toHaveLength(0);

    const eventRows = await adminDb()
      .select({ id: stripeEvents.stripeEventId })
      .from(stripeEvents)
      .where(eq(stripeEvents.stripeEventId, eventId));
    expect(eventRows).toHaveLength(0);
  });

  it("rejects a request with no stripe-signature header with 400 and writes no ledger row", async () => {
    const sessionId = await makeSessionId("missing-sig");
    const eventId = await makeEventId("missing-sig");
    const session: SeededSession = {
      id: sessionId,
      amount_total: priceForLesson(30, 1),
      metadata: {
        kind: "topup",
        householdId: owner.householdId,
        actorId: owner.userId,
        durationMinutes: "30",
        swimmerCount: "1",
      },
      payment_intent: null,
    };
    seedSession(session);
    const event = completedEvent({ eventId, session });

    const res = await request(app)
      .post("/webhooks/stripe")
      .set("Content-Type", "application/json")
      .send(jsonBody(event));

    expect(res.status).toBe(400);

    const ledgerRows = await adminDb()
      .select({ id: householdBalanceLedger.id })
      .from(householdBalanceLedger)
      .where(eq(householdBalanceLedger.householdId, owner.householdId));
    expect(ledgerRows).toHaveLength(0);
  });

  it("credits balance exactly once when the same event id is delivered twice (Layer 1 dedup)", async () => {
    const sessionId = await makeSessionId("replay-same-event");
    const eventId = await makeEventId("replay-same-event");
    const expected = priceForLesson(60, 2);
    const session: SeededSession = {
      id: sessionId,
      amount_total: expected,
      metadata: {
        kind: "topup",
        householdId: owner.householdId,
        actorId: owner.userId,
        durationMinutes: "60",
        swimmerCount: "2",
      },
      payment_intent: "pi_test_replay",
    };
    seedSession(session);
    const event = completedEvent({ eventId, session });

    const first = await request(app)
      .post("/webhooks/stripe")
      .set("Stripe-Signature", `sig:${eventId}`)
      .set("Content-Type", "application/json")
      .send(jsonBody(event));
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ reason: "processed" });

    const second = await request(app)
      .post("/webhooks/stripe")
      .set("Stripe-Signature", `sig:${eventId}`)
      .set("Content-Type", "application/json")
      .send(jsonBody(event));
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ reason: "replay" });

    // Exactly one card_topup ledger row with the expected amount.
    const ledgerRows = await adminDb()
      .select({
        amountCents: householdBalanceLedger.amountCents,
        entryType: householdBalanceLedger.entryType,
      })
      .from(householdBalanceLedger)
      .where(eq(householdBalanceLedger.householdId, owner.householdId));
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows[0]?.entryType).toBe("card_topup");
    expect(ledgerRows[0]?.amountCents).toBe(expected);
  });

  it("credits balance exactly once when a second, different event arrives for the same checkout session id (Layer 2 DB UNIQUE)", async () => {
    const sessionId = await makeSessionId("same-session-diff-event");
    const expected = priceForLesson(45, 1);
    const session: SeededSession = {
      id: sessionId,
      amount_total: expected,
      metadata: {
        kind: "topup",
        householdId: owner.householdId,
        actorId: owner.userId,
        durationMinutes: "45",
        swimmerCount: "1",
      },
      payment_intent: "pi_test_dup_session",
    };
    seedSession(session);

    const firstEventId = await makeEventId("dup-session-a");
    const firstEvent = completedEvent({ eventId: firstEventId, session });
    const first = await request(app)
      .post("/webhooks/stripe")
      .set("Stripe-Signature", `sig:${firstEventId}`)
      .set("Content-Type", "application/json")
      .send(jsonBody(firstEvent));
    expect(first.status).toBe(200);
    expect(first.body.reason).toBe("processed");

    // A second completed event with a brand-new event id (passes Layer 1)
    // but the same checkout session id (Layer 2 catches it).
    const secondEventId = await makeEventId("dup-session-b");
    const secondEvent = completedEvent({ eventId: secondEventId, session });
    const second = await request(app)
      .post("/webhooks/stripe")
      .set("Stripe-Signature", `sig:${secondEventId}`)
      .set("Content-Type", "application/json")
      .send(jsonBody(secondEvent));
    expect(second.status).toBe(200);
    expect(second.body.reason).toBe("already_credited");

    const ledgerRows = await adminDb()
      .select({
        amountCents: householdBalanceLedger.amountCents,
        stripeSession: householdBalanceLedger.stripeCheckoutSessionId,
      })
      .from(householdBalanceLedger)
      .where(
        and(
          eq(householdBalanceLedger.householdId, owner.householdId),
          eq(householdBalanceLedger.entryType, "card_topup"),
        ),
      );
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows[0]?.amountCents).toBe(expected);
    expect(ledgerRows[0]?.stripeSession).toBe(sessionId);
  });

  it("refuses to credit when the webhook amount_total does not match the pricing module (tampered metadata)", async () => {
    const sessionId = await makeSessionId("tampered-amount");
    const eventId = await makeEventId("tampered-amount");
    const expected = priceForLesson(30, 1);
    // Tamper: the metadata says (30 min, 1 swimmer) but amount_total is
    // doubled. Our pricing module says $60; Stripe says $120. Mismatch
    // → no credit.
    const session: SeededSession = {
      id: sessionId,
      amount_total: expected * 2,
      metadata: {
        kind: "topup",
        householdId: owner.householdId,
        actorId: owner.userId,
        durationMinutes: "30",
        swimmerCount: "1",
      },
      payment_intent: "pi_tampered",
    };
    seedSession(session);
    const event = completedEvent({ eventId, session });

    const res = await request(app)
      .post("/webhooks/stripe")
      .set("Stripe-Signature", `sig:${eventId}`)
      .set("Content-Type", "application/json")
      .send(jsonBody(event));
    expect(res.status).toBe(200);
    expect(res.body.reason).toBe("amount_mismatch");

    const ledgerRows = await adminDb()
      .select({ id: householdBalanceLedger.id })
      .from(householdBalanceLedger)
      .where(eq(householdBalanceLedger.householdId, owner.householdId));
    expect(ledgerRows).toHaveLength(0);

    // The stripe_events row stays so we don't retry on replay.
    const eventRows = await adminDb()
      .select({ processedAt: stripeEvents.processedAt })
      .from(stripeEvents)
      .where(eq(stripeEvents.stripeEventId, eventId));
    expect(eventRows).toHaveLength(1);
    expect(eventRows[0]?.processedAt).not.toBeNull();
  });

  it("refuses to credit when metadata.householdId does not match an existing household", async () => {
    const sessionId = await makeSessionId("bad-household");
    const eventId = await makeEventId("bad-household");
    const expected = priceForLesson(30, 1);
    const session: SeededSession = {
      id: sessionId,
      amount_total: expected,
      metadata: {
        kind: "topup",
        // Valid UUID shape, but not a real household.
        householdId: "11111111-1111-1111-1111-111111111111",
        actorId: owner.userId,
        durationMinutes: "30",
        swimmerCount: "1",
      },
      payment_intent: null,
    };
    seedSession(session);
    const event = completedEvent({ eventId, session });

    const res = await request(app)
      .post("/webhooks/stripe")
      .set("Stripe-Signature", `sig:${eventId}`)
      .set("Content-Type", "application/json")
      .send(jsonBody(event));
    expect(res.status).toBe(200);
    expect(res.body.reason).toBe("household_missing");

    const ledgerRows = await adminDb()
      .select({ id: householdBalanceLedger.id })
      .from(householdBalanceLedger);
    expect(ledgerRows).toHaveLength(0);
  });

  it("refuses to credit when metadata is missing the discriminator", async () => {
    const sessionId = await makeSessionId("bad-metadata");
    const eventId = await makeEventId("bad-metadata");
    const session: SeededSession = {
      id: sessionId,
      amount_total: 6_000,
      // No `kind` → discriminated-union parse fails.
      metadata: {
        householdId: owner.householdId,
        actorId: owner.userId,
      },
      payment_intent: null,
    };
    seedSession(session);
    const event = completedEvent({ eventId, session });

    const res = await request(app)
      .post("/webhooks/stripe")
      .set("Stripe-Signature", `sig:${eventId}`)
      .set("Content-Type", "application/json")
      .send(jsonBody(event));
    expect(res.status).toBe(200);
    expect(res.body.reason).toBe("metadata_invalid");

    const ledgerRows = await adminDb()
      .select({ id: householdBalanceLedger.id })
      .from(householdBalanceLedger)
      .where(eq(householdBalanceLedger.householdId, owner.householdId));
    expect(ledgerRows).toHaveLength(0);
  });

  it("credits both package_purchase and package_bonus rows atomically on a package checkout event", async () => {
    const sessionId = await makeSessionId("pkg-complete");
    const eventId = await makeEventId("pkg-complete");
    const { priceCents, bonusCents, creditCents } = packagePrice("deep_end", 2);
    const session: SeededSession = {
      id: sessionId,
      amount_total: priceCents,
      metadata: {
        kind: "package",
        householdId: owner.householdId,
        actorId: owner.userId,
        packageTier: "deep_end",
        swimmerCount: "2",
      },
      payment_intent: "pi_pkg",
    };
    seedSession(session);
    const event = completedEvent({ eventId, session });

    const res = await request(app)
      .post("/webhooks/stripe")
      .set("Stripe-Signature", `sig:${eventId}`)
      .set("Content-Type", "application/json")
      .send(jsonBody(event));
    expect(res.status).toBe(200);
    expect(res.body.reason).toBe("processed");

    const rows = await adminDb()
      .select({
        entryType: householdBalanceLedger.entryType,
        amountCents: householdBalanceLedger.amountCents,
        stripeSession: householdBalanceLedger.stripeCheckoutSessionId,
      })
      .from(householdBalanceLedger)
      .where(eq(householdBalanceLedger.householdId, owner.householdId));
    expect(rows).toHaveLength(2);
    const byType = new Map(rows.map((row) => [row.entryType, row.amountCents]));
    expect(byType.get("package_purchase")).toBe(priceCents);
    expect(byType.get("package_bonus")).toBe(bonusCents);
    // The balance should move by the full credit.
    const total = rows.reduce((sum, row) => sum + row.amountCents, 0);
    expect(total).toBe(creditCents);
    // Both rows share the session id.
    expect(rows.every((row) => row.stripeSession === sessionId)).toBe(true);
  });
});

// ── POST /payments/checkout-session guards ──────────────────────────────────

describe("POST /payments/checkout-session", () => {
  it("creates a Stripe session and returns the URL — amount is computed server-side from pricing inputs only", async () => {
    const res = await request(app)
      .post("/payments/checkout-session")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .set("Content-Type", "application/json")
      .send({
        kind: "topup",
        lessonTopup: { durationMinutes: 60, swimmerCount: 1 },
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("url");
    expect(res.body).toHaveProperty("sessionId");
    expect(typeof res.body.url).toBe("string");
    expect(res.body.url).toMatch(/^https:\/\/checkout\.stripe\.test\//);
  });

  it("rejects an amount passed in the body — Zod .strict() strips/rejects unknown keys", async () => {
    const res = await request(app)
      .post("/payments/checkout-session")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .set("Content-Type", "application/json")
      .send({
        kind: "topup",
        lessonTopup: { durationMinutes: 30, swimmerCount: 1 },
        // Browser tries to override the amount.
        amountCents: 1,
      });

    expect(res.status).toBe(422);
  });

  it("rejects a householdId passed in the body — the auth session is the only source of truth", async () => {
    const res = await request(app)
      .post("/payments/checkout-session")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .set("Content-Type", "application/json")
      .send({
        kind: "topup",
        lessonTopup: { durationMinutes: 30, swimmerCount: 1 },
        householdId: "99999999-9999-9999-9999-999999999999",
      });

    expect(res.status).toBe(422);
  });

  it("rejects a packagePrice passed in a package body", async () => {
    const res = await request(app)
      .post("/payments/checkout-session")
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .set("Content-Type", "application/json")
      .send({
        kind: "package",
        packageTier: "cannonball",
        swimmerCount: 1,
        priceCents: 1,
      });

    expect(res.status).toBe(422);
  });

  it("rejects unauthenticated requests with 401", async () => {
    const res = await request(app)
      .post("/payments/checkout-session")
      .set("Content-Type", "application/json")
      .send({
        kind: "topup",
        lessonTopup: { durationMinutes: 30, swimmerCount: 1 },
      });

    expect(res.status).toBe(401);
  });
});

// ── Success redirect is cosmetic — not a credit path ────────────────────────

describe("ADR 036 §3: success redirect never credits", () => {
  it("the Stripe success_url contains no server-side credit path — the only crediting path is the signed webhook, and an unsigned request to it 400s", async () => {
    // The /account/balance?topup=success page lives on apps/web, not on
    // the API — the API has no GET /payments/success or similar. Prove
    // the absence: a POST to /webhooks/stripe without a signature is
    // rejected, which is the only API endpoint that could credit.
    const res = await request(app)
      .post("/webhooks/stripe")
      .set("Content-Type", "application/json")
      .send(jsonBody({ id: "evt_unsigned", type: "checkout.session.completed" }));
    expect(res.status).toBe(400);
  });
});
