// Transactional outbox writer for the coach-side `coach_account_deleted`
// email (ADR 034). Called inside the same db.transaction() as the solo
// account deletion that freed the slots.
//
// The row has no lesson/batch/bulk-cancellation scope — the family is
// gone by the time this fires. The outbox CHECK constraint carves out
// `event = 'coach_account_deleted'` from the exactly-one-scope rule.
//
// No HTTP, render, or transport work here — the sender picks up this
// row after the deletion transaction commits.

import { and, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "../../db/schema";
import { lessonEmailOutbox } from "../../db/schema";
import { getActiveCoachProfile } from "../../lib/coachProfile";
import type {
  AccountDeletedEmailLesson,
  AccountDeletedEmailPayload,
} from "./accountDeletedTypes";

type Tx = PostgresJsDatabase<typeof schema>;

export interface EnqueueCoachAccountDeletedInput {
  cancelledLessons: AccountDeletedEmailLesson[];
  scheduleUrl: string;
  now: Date;
}

// Insert exactly one `coach_account_deleted` outbox row inside the given
// transaction. Returns the new row's id, or null when no active coach
// profile exists (nothing to email). Call AFTER the household-scoped
// outbox scrub so this row isn't picked up by the scrub's where-clauses.
export async function enqueueCoachAccountDeletedEmail(
  tx: Tx,
  input: EnqueueCoachAccountDeletedInput,
): Promise<string | null> {
  const coach = await getActiveCoachProfile();
  if (!coach) return null;

  const payload: AccountDeletedEmailPayload = {
    kind: "account_deleted_email",
    cancelledLessons: input.cancelledLessons,
    scheduleUrl: input.scheduleUrl,
    deletedAtUtc: input.now.toISOString(),
  };

  // Scope columns are all null — the family is gone. The CHECK
  // constraint on the table carves out `event = 'coach_account_deleted'`
  // so this row is legal. Sequence is a stable 1 (no dedup namespace
  // meaningfully shared with other rows — the (lesson_id, event, seq)
  // unique index is partial on lesson_id IS NOT NULL, so a null-scope
  // row never collides).
  const nextSequence = await nextSequenceForCoach(tx, coach.id);
  const rows = await tx
    .insert(lessonEmailOutbox)
    .values({
      event: "coach_account_deleted",
      sequence: nextSequence,
      recipientProfileIds: [coach.id],
      icsMethod: null,
      icsSequence: null,
      payload,
    })
    .returning({ id: lessonEmailOutbox.id });

  return rows[0]?.id ?? null;
}

// Per-coach occurrence counter. Rows for other coaches / events don't
// matter; the uniqueness guarantee here is "monotonically increasing
// within this coach's account_deleted history" so a future reporting
// query can order them. Partial unique indexes on the table are all
// scoped by lesson/batch/bulk, so there's no collision risk — this
// sequence is purely informational.
async function nextSequenceForCoach(tx: Tx, coachProfileId: string): Promise<number> {
  const rows = await tx
    .select({ max: sql<number | null>`max(${lessonEmailOutbox.sequence})` })
    .from(lessonEmailOutbox)
    .where(
      and(
        eq(lessonEmailOutbox.event, "coach_account_deleted"),
        sql`${lessonEmailOutbox.recipientProfileIds} = ARRAY[${coachProfileId}]::uuid[]`,
      ),
    );
  return (rows[0]?.max ?? 0) + 1;
}
