// Transactional outbox writer for the `balance_cashed_out` email event
// (ADR 036 Phase 8 Part B). Called inside the executeCashOut
// transaction that writes the cash_refund + balance_writeoff ledger
// rows — ledger rows + audit rows + email row land together or roll
// back together.

import { and, eq, inArray, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "../../db/schema";
import { householdMembers, lessonEmailOutbox } from "../../db/schema";
import { getActiveCoachProfile } from "../../lib/coachProfile";
import { buildBalancePageLink } from "./format";
import type { BalanceCashedOutEmailPayload } from "./balanceCashedOutTypes";

type Tx = PostgresJsDatabase<typeof schema>;

export interface EnqueueBalanceCashedOutInput {
  householdId: string;
  totalCardPaidCents: number;
  totalCashRefundedPriorCents: number;
  netLessonSpendingCents: number;
  refundableCents: number;
  writeOffCents: number;
  siteUrl: string;
}

// Insert one `balance_cashed_out` row inside the given transaction.
// Returns the new row's id, or null when the household has no owner /
// manager recipients.
export async function enqueueBalanceCashedOutEmail(
  tx: Tx,
  input: EnqueueBalanceCashedOutInput,
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

  const payload: BalanceCashedOutEmailPayload = {
    kind: "balance_cashed_out",
    totalCardPaidCents: input.totalCardPaidCents,
    totalCashRefundedPriorCents: input.totalCashRefundedPriorCents,
    netLessonSpendingCents: input.netLessonSpendingCents,
    refundableCents: input.refundableCents,
    writeOffCents: input.writeOffCents,
    deepLink: buildBalancePageLink(input.siteUrl),
    coachFirstName,
  };

  const nextSequence = await nextSequenceForHousehold(tx, input.householdId);
  const rows = await tx
    .insert(lessonEmailOutbox)
    .values({
      event: "balance_cashed_out",
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
        eq(lessonEmailOutbox.event, "balance_cashed_out"),
        eq(lessonEmailOutbox.householdId, householdId),
      ),
    );
  return (rows[0]?.max ?? 0) + 1;
}
