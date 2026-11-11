// Policy acceptance schemas (ADR 036 Phase 8 Part B Stop 3).
//
// Tracks each parent's acceptance of our Terms, Privacy, and Payments &
// Refund policies. Signup writes one row per policy; a version bump flips
// every existing user to "stale" and the booking / add-funds middleware
// forces a re-acceptance interstitial on the next write.
//
// Bumping a policy is a one-line change to the version constants below.
// The web pages render `Version <constant>` and the signup page passes the
// three constants as hidden form inputs so the client can never submit a
// version it did not actually see.

import { z } from "zod";

export const PolicySlugSchema = z.enum(["terms", "privacy", "payments_refund"]);
export type PolicySlug = z.infer<typeof PolicySlugSchema>;

// Policy version constants. Exported so the web page renderer and
// the signup form's hidden input stay in lockstep. Bumping a policy
// is a one-line change here. Each version string is the date the
// current copy was published (America/Los_Angeles).
export const TERMS_VERSION = "2026-11-11";
export const PRIVACY_VERSION = "2026-11-11";
export const PAYMENTS_REFUND_VERSION = "2026-11-11";

export function currentVersionFor(slug: PolicySlug): string {
  switch (slug) {
    case "terms":
      return TERMS_VERSION;
    case "privacy":
      return PRIVACY_VERSION;
    case "payments_refund":
      return PAYMENTS_REFUND_VERSION;
  }
}

export const AcceptPoliciesBodySchema = z
  .object({
    acceptances: z
      .array(
        z.object({
          policySlug: PolicySlugSchema,
          version: z.string(),
        }),
      )
      .min(1)
      .max(3),
  })
  .strict();
export type AcceptPoliciesBody = z.infer<typeof AcceptPoliciesBodySchema>;

export const AcceptPoliciesResponseSchema = z.object({
  acceptedSlugs: z.array(PolicySlugSchema),
});
export type AcceptPoliciesResponse = z.infer<typeof AcceptPoliciesResponseSchema>;

export const MissingPolicyAcceptancesResponseSchema = z.object({
  missing: z.array(
    z.object({
      policySlug: PolicySlugSchema,
      currentVersion: z.string(),
      lastAcceptedVersion: z.string().nullable(),
    }),
  ),
});
export type MissingPolicyAcceptancesResponse = z.infer<
  typeof MissingPolicyAcceptancesResponseSchema
>;
