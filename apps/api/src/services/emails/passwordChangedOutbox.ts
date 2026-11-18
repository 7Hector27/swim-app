// Transactional outbox writer for the `password_changed` email event.
// Called inside the same db.transaction() as the password-change flow's
// audit log write so the email is lost or committed with the state — never
// half-sent. Pattern mirrors coachAccountDeletedOutbox: scope columns stay
// null, event is in the CHECK's exemption list.

import { and, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "../../db/schema";
import { lessonEmailOutbox } from "../../db/schema";
import type {
  PasswordChangedEmailPayload,
  PasswordChangedSource,
} from "./passwordChangedTypes";

type Tx = PostgresJsDatabase<typeof schema>;

export interface EnqueuePasswordChangedInput {
  // Auth user id (mirrors profiles.id) — the single recipient.
  profileId: string;
  source: PasswordChangedSource;
  now: Date;
  // Absolute /forgot-password URL. Built by the route from env.siteUrl.
  resetPasswordUrl: string;
}

export async function enqueuePasswordChangedEmail(
  tx: Tx,
  input: EnqueuePasswordChangedInput,
): Promise<string | null> {
  const payload: PasswordChangedEmailPayload = {
    kind: "password_changed_email",
    source: input.source,
    changedAtUtc: input.now.toISOString(),
    resetPasswordUrl: input.resetPasswordUrl,
  };

  const nextSequence = await nextSequenceForProfile(tx, input.profileId);
  const rows = await tx
    .insert(lessonEmailOutbox)
    .values({
      event: "password_changed",
      sequence: nextSequence,
      recipientProfileIds: [input.profileId],
      icsMethod: null,
      icsSequence: null,
      payload,
    })
    .returning({ id: lessonEmailOutbox.id });

  return rows[0]?.id ?? null;
}

// Per-profile occurrence counter. Partial unique indexes on this table
// are all scoped by lesson/batch/bulk_cancellation, so a null-scope row
// never collides. The sequence is informational — useful for "which
// password-change email was #3 for this user?" debug queries.
async function nextSequenceForProfile(tx: Tx, profileId: string): Promise<number> {
  const rows = await tx
    .select({ max: sql<number | null>`max(${lessonEmailOutbox.sequence})` })
    .from(lessonEmailOutbox)
    .where(
      and(
        eq(lessonEmailOutbox.event, "password_changed"),
        eq(lessonEmailOutbox.recipientProfileIds, [profileId]),
      ),
    );
  return (rows[0]?.max ?? 0) + 1;
}
