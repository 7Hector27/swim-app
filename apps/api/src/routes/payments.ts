// Payments routes (ADR 036 Phase 3).
//
// POST /payments/checkout-session — creates a Stripe-hosted Checkout session
// and returns the URL the client redirects to. The body carries only pricing
// inputs (`kind` + the discriminated union); the amount is computed
// server-side from the shared pricing module and the authenticated user's
// household id is read from the session, never the body.
//
// The webhook route lives in app.ts rather than this router so it can be
// wired before `express.json()` with its own raw-body middleware.

import { Router } from "express";

import {
  CheckoutSessionBodySchema,
  type CheckoutSessionBody,
  type CheckoutSessionResponse,
} from "@swim-app/shared";

import { getEnv } from "../lib/env";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireHouseholdMember } from "../middleware/requireHouseholdMember";
import { requireParent } from "../middleware/requireParent";
import { requireUser } from "../middleware/requireUser";
import { validate } from "../middleware/validate";
import { createCheckoutSession } from "../services/stripe";

export const paymentsRouter = Router();

paymentsRouter.post(
  "/checkout-session",
  requireUser,
  requireParent,
  requireHouseholdMember,
  validate({ body: CheckoutSessionBodySchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as CheckoutSessionBody;

    const result = await createCheckoutSession({
      householdId: req.householdId,
      actorId: req.profile.id,
      siteUrl: getEnv().siteUrl,
      body,
    });

    const response: CheckoutSessionResponse = {
      url: result.url,
      sessionId: result.sessionId,
    };
    res.status(201).json(response);
  }),
);
