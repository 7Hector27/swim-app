// Policy acceptance routes (ADR 036 Phase 8 Part B Stop 3).
//
// Mounted under /me/policies behind requireUser in app.ts. Both endpoints
// scope to the authenticated caller's profile id and household.
//
//   GET  /me/policies/missing — per-slug staleness snapshot the web
//     `/policy-updated` interstitial pre-fetches to decide which policies
//     to re-render + re-accept.
//
//   POST /me/policies/accept — writes one acceptance row per submitted
//     policy with source='reaccept_prompt'. Each submitted version must
//     equal the current constant for its slug or the whole request is
//     rejected with 422 — never half-accept.

import { Router } from "express";

import {
  AcceptPoliciesBodySchema,
  type AcceptPoliciesBody,
  type AcceptPoliciesResponse,
  type MissingPolicyAcceptancesResponse,
  currentVersionFor,
} from "@swim-app/shared";

import { db } from "../db/client";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireHouseholdMember } from "../middleware/requireHouseholdMember";
import { requireParent } from "../middleware/requireParent";
import { validate } from "../middleware/validate";
import {
  applyPolicyAcceptance,
  getMissingPolicyAcceptances,
} from "../services/policyAcceptance";

export const policiesRouter = Router();

policiesRouter.get(
  "/missing",
  requireParent,
  requireHouseholdMember,
  validate({}),
  asyncHandler(async (req, res) => {
    const missing = await getMissingPolicyAcceptances(db, req.profile.id);
    const body: MissingPolicyAcceptancesResponse = { missing };
    res.json(body);
  }),
);

policiesRouter.post(
  "/accept",
  requireParent,
  requireHouseholdMember,
  validate({ body: AcceptPoliciesBodySchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as AcceptPoliciesBody;
    const userId = req.profile.id;
    const householdId = req.householdId;

    // Validate every submitted (slug, version) matches the current
    // constant. If any slug is behind, the write is rejected for the whole
    // batch — the web interstitial always submits the current versions,
    // so a mismatch here means the client is stale and needs to refresh.
    const stale: { policySlug: string; currentVersion: string }[] = [];
    for (const row of body.acceptances) {
      const expected = currentVersionFor(row.policySlug);
      if (row.version !== expected) {
        stale.push({
          policySlug: row.policySlug,
          currentVersion: expected,
        });
      }
    }
    if (stale.length > 0) {
      res.status(422).json({ error: "stale_policy_versions", stale });
      return;
    }

    await db.transaction(async (tx) => {
      for (const row of body.acceptances) {
        await applyPolicyAcceptance(tx, {
          userId,
          policySlug: row.policySlug,
          version: row.version,
          source: "reaccept_prompt",
          actorId: userId,
          householdId,
        });
      }
    });

    const response: AcceptPoliciesResponse = {
      acceptedSlugs: body.acceptances.map((row) => row.policySlug),
    };
    res.status(201).json(response);
  }),
);
