// Gates a route on the parent being current on every tracked policy
// (ADR 036 Phase 8 Part B Stop 3 piece 3). Stacks AFTER `requireUser` +
// `requireParent` so `req.profile.id` is set, and only on write routes
// that should block when a version bump hasn't been re-accepted:
//
//   POST /lessons                 — single booking
//   POST /lessons/batch           — multiple + recurring booking
//   POST /payments/checkout-session — top-ups and packages
//
// Read routes (GET /me/balance, GET /me/balance/history, GET /lessons,
// everything on the account page) stay unguarded. Account deletion is
// explicitly exempt too — a parent must always be able to close their
// account regardless of policy state.
//
// `requireParent` already 403s coaches before this middleware runs, so
// the coach never sees a 409 from here.
//
// 409 shape matches `MissingPolicyAcceptancesResponse.missing` from
// `@swim-app/shared`: a list of `{ policySlug, currentVersion,
// lastAcceptedVersion }` objects. The web app catches this status +
// error code and redirects to the `/policy-updated` interstitial with
// the current path as `?next=`.

import type { NextFunction, Request, Response } from "express";

import { db } from "../db/client";
import { getMissingPolicyAcceptances } from "../services/policyAcceptance";

export async function requireCurrentPolicyAcceptance(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const missing = await getMissingPolicyAcceptances(db, req.profile.id);
  if (missing.length === 0) {
    next();
    return;
  }
  res.status(409).json({
    error: "policy_acceptance_required",
    missing,
  });
}
