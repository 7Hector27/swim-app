// Policy acceptance writes (ADR 036 Phase 8 Part B Stop 3).
//
// Inserts a row into `user_policy_acceptances` and pairs it with a
// `household_audit_log` entry in the same transaction. The audit entry is
// scoped to the user's household because that's where the row lives in our
// append-only audit model — there is no per-user audit log.
//
// The signup path calls `applyPolicyAcceptance` three times (once per
// tracked policy) inside the same transaction as the profile + auth user
// creation. The re-acceptance route calls it once per submitted policy.
// Both paths record `source` so a later audit can tell signup from a
// version-bump reprompt.
//
// household_audit_log.household_id is NOT NULL (schema.ts). The signup
// flow happens AFTER the on_auth_user_created trigger has already created
// a household + owner membership, so a household id is always available —
// the service requires it for that reason.

import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "../../db/schema";
import { householdAuditLog, userPolicyAcceptances } from "../../db/schema";
import type { PolicySlug } from "@swim-app/shared";

type Tx = PostgresJsDatabase<typeof schema>;

export type PolicyAcceptanceSource = "signup" | "reaccept_prompt";

export interface ApplyPolicyAcceptanceArgs {
  userId: string;
  policySlug: PolicySlug;
  version: string;
  source: PolicyAcceptanceSource;
  // actorId == userId on signup + reaccept paths. Kept explicit so the
  // audit log row names a party even if some future admin tool ever
  // writes an acceptance on behalf of a user.
  actorId: string;
  householdId: string;
}

// Writes one user_policy_acceptances row + one paired household_audit_log
// row. Returns the inserted acceptance's id for diagnostics.
export async function applyPolicyAcceptance(
  tx: Tx,
  args: ApplyPolicyAcceptanceArgs,
): Promise<string> {
  const inserted = await tx
    .insert(userPolicyAcceptances)
    .values({
      userId: args.userId,
      policySlug: args.policySlug,
      version: args.version,
      source: args.source,
    })
    .returning({ id: userPolicyAcceptances.id });

  const id = inserted[0]?.id;
  if (!id) {
    // Insert returning() is deterministic; a missing row here is an
    // environment-level failure (e.g. the test container restarted mid-tx).
    throw new Error("user_policy_acceptances insert returned no row");
  }

  await tx.insert(householdAuditLog).values({
    householdId: args.householdId,
    actorId: args.actorId,
    action:
      args.source === "signup"
        ? "policy_accepted_signup"
        : "policy_accepted_reprompt",
    payload: {
      acceptanceId: id,
      policySlug: args.policySlug,
      version: args.version,
      userId: args.userId,
    },
  });

  return id;
}
