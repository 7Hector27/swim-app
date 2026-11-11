// Policy acceptance read (ADR 036 Phase 8 Part B Stop 3).
//
// Returns the list of slugs whose current version constant is ahead of the
// user's latest acceptance (or has no acceptance yet). Consumed by
//
//   GET /me/policies/missing — the interstitial-prefetch shape.
//   requireCurrentPolicyAcceptance middleware — same query, 409 shape.
//
// Reads from a plain drizzle handle (not a transaction) because both
// callers are read-only paths. The index
// `user_policy_acceptances_user_policy_accepted_at_idx` on
// (user_id, policy_slug, accepted_at DESC) makes the per-slug DISTINCT ON
// walk trivial.

import { desc, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "../../db/schema";
import { userPolicyAcceptances } from "../../db/schema";
import {
  currentVersionFor,
  type MissingPolicyAcceptancesResponse,
  type PolicySlug,
} from "@swim-app/shared";

type Db = PostgresJsDatabase<typeof schema>;

const TRACKED_SLUGS: ReadonlyArray<PolicySlug> = [
  "terms",
  "privacy",
  "payments_refund",
];

export async function getMissingPolicyAcceptances(
  db: Db,
  userId: string,
): Promise<MissingPolicyAcceptancesResponse["missing"]> {
  // Latest acceptance per (user, policy) via DISTINCT ON. Postgres-specific,
  // but we're already on postgres and the ordered index makes this O(k)
  // where k = number of distinct slugs the user has ever accepted (≤ 3).
  const rows = await db
    .select({
      policySlug: userPolicyAcceptances.policySlug,
      version: userPolicyAcceptances.version,
    })
    .from(userPolicyAcceptances)
    .where(eq(userPolicyAcceptances.userId, userId))
    .orderBy(
      userPolicyAcceptances.policySlug,
      desc(userPolicyAcceptances.acceptedAt),
    )
    .limit(100);

  // Walk rows and pick the first (= most recent) per slug.
  const latestBySlug = new Map<string, string>();
  for (const row of rows) {
    if (!latestBySlug.has(row.policySlug)) {
      latestBySlug.set(row.policySlug, row.version);
    }
  }

  const missing: MissingPolicyAcceptancesResponse["missing"] = [];
  for (const slug of TRACKED_SLUGS) {
    const currentVersion = currentVersionFor(slug);
    const lastAccepted = latestBySlug.get(slug) ?? null;
    if (lastAccepted !== currentVersion) {
      missing.push({
        policySlug: slug,
        currentVersion,
        lastAcceptedVersion: lastAccepted,
      });
    }
  }
  return missing;
}
