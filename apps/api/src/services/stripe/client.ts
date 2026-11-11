// Stripe client factory (ADR 036 Phase 3).
//
// The real Stripe SDK is constructed lazily on first use so an API boot
// without STRIPE_SECRET_KEY still succeeds under APP_ENV=local — only the
// payments routes break. Tests inject a stub via __setStripeClientForTests
// so integration coverage never calls out to Stripe's servers.

import Stripe from "stripe";

import { getEnv } from "../../lib/env";

// Minimal surface of the Stripe SDK the payments service touches. Keeping
// the interface narrow means the test stub only has to implement what
// webhook processing and checkout creation actually call — a full Stripe
// mock would be hundreds of methods we never use.
export interface StripeAdapter {
  checkout: {
    sessions: {
      create: Stripe["checkout"]["sessions"]["create"];
      retrieve: Stripe["checkout"]["sessions"]["retrieve"];
    };
  };
  webhooks: {
    constructEvent: Stripe["webhooks"]["constructEvent"];
  };
  // ADR 036 Phase 8 Part B — cash-out refund engine. The drain calls
  // refunds.create with the job's idempotency_key so a retry after a
  // network blip never double-charges.
  refunds: {
    create: Stripe["refunds"]["create"];
  };
}

let override: StripeAdapter | undefined;
let real: Stripe | undefined;

export function getStripe(): StripeAdapter {
  if (override) return override;
  if (real) return real;
  const env = getEnv();
  if (!env.stripe) {
    throw new Error(
      "Stripe is not configured. Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET in apps/api/.env " +
        "(see apps/api/.env.example and docs/decisions/036-payments-stripe-prepaid-balance.md).",
    );
  }
  real = new Stripe(env.stripe.secretKey, {
    // Pinned so a Stripe API change doesn't quietly alter response shapes
    // under us. Bump with intent and re-test the webhook + checkout flows.
    apiVersion: "2024-06-20" as Stripe.LatestApiVersion,
  });
  return real;
}

export function __setStripeClientForTests(client: StripeAdapter | undefined): void {
  override = client;
  // Drop the cached real client too so a test that unsets the override and
  // then re-parses env with a fresh key gets a fresh Stripe instance.
  real = undefined;
}
