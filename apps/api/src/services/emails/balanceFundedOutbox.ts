// Transactional outbox writer for the `balance_funded` email event
// (ADR 036 Phase 7). Called inside the Stripe webhook transaction that
// writes the card_topup / package_purchase rows, so the email is lost or
// committed with the ledger — never half-sent.
//
// Pattern mirrors coachAccountDeletedOutbox: scope columns stay null
// (balance rows don't map to a lesson / batch / bulk cancellation) and
// the exactly-one scope CHECK carves out `event IN ('balance_funded',
// 'balance_adjusted')` so the insert is legal.

import { and, eq, inArray, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "../../db/schema";
import {
  householdMembers,
  lessonEmailOutbox,
} from "../../db/schema";
import { getActiveCoachProfile } from "../../lib/coachProfile";
import { buildBalancePageLink } from "./format";
import type {
  BalanceFundedEmailPayload,
  BalanceFundedKind,
} from "./balanceFundedTypes";

type Tx = PostgresJsDatabase<typeof schema>;

export interface EnqueueBalanceFundedInput {
  householdId: string;
  type: BalanceFundedKind;
  amountPaidCents: number;
  bonusCents: number;
  newBalanceCents: number;
  siteUrl: string;
}

// Insert one `balance_funded` row inside the given transaction. Returns
// the new row's id, or null when the household has no owner / manager
// recipients (edge case — a Stripe webhook would still have written the
// ledger; we just don't have anyone to email). Fully silent on that
// branch so a committing transaction isn't rolled back by a missing
// recipient.
export async function enqueueBalanceFundedEmail(
  tx: Tx,
  input: EnqueueBalanceFundedInput,
): Promise<string | null> {
  const memberRows = await tx
    .select({ profileId: householdMembers.profileId })
    .from(householdMembers)
    .where(
      and(
        eq(householdMembers.householdId, input.householdId),
        inArray(householdMembers.role, ["owner", "manager"]),
      ),
    );
  const recipientProfileIds = memberRows.map((row) => row.profileId);
  if (recipientProfileIds.length === 0) return null;

  // Snapshotted so a later rename on profiles.full_name doesn't
  // retroactively repaint this scheduled email. Null (= no active
  // coach) falls back to "The coach" in the renderer.
  const coachFirstName = (await getActiveCoachProfile())?.firstName ?? null;

  const payload: BalanceFundedEmailPayload = {
    kind: "balance_funded",
    type: input.type,
    amountPaidCents: input.amountPaidCents,
    bonusCents: input.bonusCents,
    newBalanceCents: input.newBalanceCents,
    deepLink: buildBalancePageLink(input.siteUrl),
    coachFirstName,
  };

  const nextSequence = await nextSequenceForHousehold(tx, input.householdId);
  const rows = await tx
    .insert(lessonEmailOutbox)
    .values({
      event: "balance_funded",
      householdId: input.householdId,
      sequence: nextSequence,
      recipientProfileIds,
      icsMethod: null,
      icsSequence: null,
      payload,
    })
    .returning({ id: lessonEmailOutbox.id });

  return rows[0]?.id ?? null;
}

// Per-household monotonically-increasing sequence across all balance_
// funded rows. The partial unique indexes on lesson_email_outbox are
// scoped by lesson/batch/bulk_cancellation, so a null-scope row never
// collides with a per-lesson row. This sequence is purely informational
// — useful for "which top-up email was #3 for this family?" debug queries.
async function nextSequenceForHousehold(
  tx: Tx,
  householdId: string,
): Promise<number> {
  const rows = await tx
    .select({ max: sql<number | null>`max(${lessonEmailOutbox.sequence})` })
    .from(lessonEmailOutbox)
    .where(
      and(
        eq(lessonEmailOutbox.event, "balance_funded"),
        eq(lessonEmailOutbox.householdId, householdId),
      ),
    );
  return (rows[0]?.max ?? 0) + 1;
}
