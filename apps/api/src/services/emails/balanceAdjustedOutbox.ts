// Transactional outbox writer for the `balance_adjusted` email event
// (ADR 036 Phase 7). Called inside the POST /coach/households/:id/
// balance/adjust transaction — ledger row + audit row + email row land
// together or roll back together.

import { and, eq, inArray, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "../../db/schema";
import { householdMembers, lessonEmailOutbox } from "../../db/schema";
import { getActiveCoachProfile } from "../../lib/coachProfile";
import { buildBalancePageLink } from "./format";
import type { BalanceAdjustedEmailPayload } from "./balanceAdjustedTypes";

type Tx = PostgresJsDatabase<typeof schema>;

export interface EnqueueBalanceAdjustedInput {
  householdId: string;
  amountCents: number;
  newBalanceCents: number;
  reason: string;
  siteUrl: string;
}

// Insert one `balance_adjusted` row inside the given transaction.
// Returns the new row's id, or null when the household has no owner /
// manager recipients (shouldn't happen for a coach adjustment, but the
// outbox stays consistent with the `balance_funded` writer's shape).
export async function enqueueBalanceAdjustedEmail(
  tx: Tx,
  input: EnqueueBalanceAdjustedInput,
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

  const coachFirstName = (await getActiveCoachProfile())?.firstName ?? null;

  const payload: BalanceAdjustedEmailPayload = {
    kind: "balance_adjusted",
    amountCents: input.amountCents,
    newBalanceCents: input.newBalanceCents,
    reason: input.reason,
    deepLink: buildBalancePageLink(input.siteUrl),
    coachFirstName,
  };

  const nextSequence = await nextSequenceForHousehold(tx, input.householdId);
  const rows = await tx
    .insert(lessonEmailOutbox)
    .values({
      event: "balance_adjusted",
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

async function nextSequenceForHousehold(
  tx: Tx,
  householdId: string,
): Promise<number> {
  const rows = await tx
    .select({ max: sql<number | null>`max(${lessonEmailOutbox.sequence})` })
    .from(lessonEmailOutbox)
    .where(
      and(
        eq(lessonEmailOutbox.event, "balance_adjusted"),
        eq(lessonEmailOutbox.householdId, householdId),
      ),
    );
  return (rows[0]?.max ?? 0) + 1;
}
