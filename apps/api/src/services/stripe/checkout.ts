// Stripe Checkout session creation (ADR 036 Phase 3).
//
// The browser never sends an amount — the server reads pricing inputs from
// the discriminated-union body, computes the authoritative amount from the
// shared pricing module, and hands Stripe both the amount and the pricing
// context (as metadata) in one call. The metadata is the webhook handler's
// re-validation input: on completion it reads the pricing context back,
// re-runs the pricing module, and refuses any mismatch.

import type Stripe from "stripe";

import {
  type CheckoutSessionBody,
  packagePrice,
  priceForLesson,
} from "@swim-app/shared";

import { getStripe } from "./client";
import type { CheckoutMetadata } from "./metadata";

export interface CreateCheckoutSessionInput {
  householdId: string;
  actorId: string;
  // Public base URL of the web app — Checkout redirects back here on
  // completion / cancel. Read from env by the caller (`SITE_URL`) so the
  // stripe service stays testable without touching env itself.
  siteUrl: string;
  body: CheckoutSessionBody;
}

export interface CreateCheckoutSessionResult {
  sessionId: string;
  url: string;
}

export async function createCheckoutSession(
  input: CreateCheckoutSessionInput,
): Promise<CreateCheckoutSessionResult> {
  const { metadata, amountCents, description } = buildLineItem(input);

  // The browser can suggest a relative path to return to after Checkout
  // (via `body.successReturnTo`); the Zod schema already forbids a scheme
  // or host, so joining it under `input.siteUrl` can't escape our origin.
  // Defaults to the balance page.
  const returnPath = input.body.successReturnTo ?? "/account/balance";
  const separator = returnPath.includes("?") ? "&" : "?";
  const successUrl = `${input.siteUrl}${returnPath}${separator}topup=success`;
  const cancelUrl = `${input.siteUrl}${returnPath}${separator}topup=cancelled`;

  // All amounts are integer cents under our pricing module; USD is the
  // only currency the business operates in.
  const session = await getStripe().checkout.sessions.create({
    mode: "payment",
    // Payment methods are configured in the Stripe dashboard (test + live).
    // Omitting payment_method_types lets Stripe present card plus any other
    // methods Jason enables (Link, Apple Pay, Google Pay) without a code
    // change here.
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: amountCents,
          product_data: {
            name: description,
          },
        },
      },
    ],
    // ADR 036 §3: the success redirect is cosmetic. The balance page
    // re-reads from the DB and shows a toast; it never writes, so a
    // forged success URL cannot mint credit.
    success_url: successUrl,
    cancel_url: cancelUrl,
    // Metadata is flat string→string per Stripe's API shape. The webhook
    // handler parses it back with CheckoutMetadataSchema.
    metadata: toStringMap(metadata),
  });

  if (!session.url) {
    // A Stripe-hosted Checkout session always returns a URL for `mode: payment`.
    // Null here would mean a Stripe behavior change; fail loud rather than
    // returning an unusable session.
    throw new Error("Stripe Checkout session created without a URL");
  }

  return { sessionId: session.id, url: session.url };
}

interface LineItem {
  metadata: CheckoutMetadata;
  amountCents: number;
  description: string;
}

function buildLineItem(input: CreateCheckoutSessionInput): LineItem {
  if (input.body.kind === "topup") {
    const { durationMinutes, swimmerCount } = input.body.lessonTopup;
    const amountCents = priceForLesson(durationMinutes, swimmerCount);
    return {
      amountCents,
      description: `Lesson credit · ${durationMinutes} min × ${swimmerCount} swimmer${swimmerCount === 1 ? "" : "s"}`,
      metadata: {
        kind: "topup",
        householdId: input.householdId,
        actorId: input.actorId,
        durationMinutes,
        swimmerCount,
      },
    };
  }

  const { priceCents } = packagePrice(input.body.packageTier, input.body.swimmerCount);
  const tierLabel = input.body.packageTier === "cannonball" ? "Cannonball" : "Deep End";
  return {
    amountCents: priceCents,
    description: `${tierLabel} package · ${input.body.swimmerCount} swimmer${input.body.swimmerCount === 1 ? "" : "s"}`,
    metadata: {
      kind: "package",
      householdId: input.householdId,
      actorId: input.actorId,
      packageTier: input.body.packageTier,
      swimmerCount: input.body.swimmerCount,
    },
  };
}

// Stripe's SDK types metadata as Record<string, string> — numbers, booleans,
// and nested shapes are rejected at send. Convert each field to string so a
// future metadata addition doesn't silently violate the contract.
function toStringMap(metadata: CheckoutMetadata): Stripe.MetadataParam {
  const entries: [string, string][] = Object.entries(metadata).map(
    ([key, value]) => [key, String(value)],
  );
  return Object.fromEntries(entries);
}
