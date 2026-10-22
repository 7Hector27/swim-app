// Outbox drain and retention scrub, called from POST /internal/cron/tick.
// Both passes are sequential, bounded, and never throw past their own
// internal catches. See ADR 028.

import { and, asc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { db } from "../../db/client";
import { lessonEmailOutbox } from "../../db/schema";
import { logger as rootLogger } from "../../logger";
import { sendLessonEmailOutboxRow } from "./sender";

// Sequential drain. Each row is awaited before the next so one slow
// transport call applies natural backpressure instead of launching N
// concurrent sends and tripping Resend's per-second rate limit.
const DRAIN_LIMIT_PER_TICK = 50;

// Payload scrub batch size per tick. Scrubbing is idempotent and cheap;
// 500 keeps the transaction short even on first run of a crowded table.
const SCRUB_LIMIT_PER_TICK = 500;

const SCRUB_AGE_DAYS = 30;

// A 'failed' row older than this becomes terminal ('abandoned'). The drain
// stops retrying it and the row's payload is purged by the 30-day scrub.
// Without this, failed rows would hold swimmer first names and (for
// home-pool lessons) full residential addresses indefinitely.
const ABANDON_AGE_DAYS = 7;

// Per-tick cap on the abandon UPDATE. Mirrors the scrub cap — a one-time
// large sweep after launch should spread across several ticks instead of
// holding a heavy table lock in one statement.
const ABANDON_LIMIT_PER_TICK = 500;

const log = rootLogger.child({ component: "lesson-email-drain" });

export interface DrainResult {
  drained: number;
  abandoned: number;
}

export interface ScrubResult {
  scrubbed: number;
}

export async function drainLessonEmailOutbox(): Promise<DrainResult> {
  const now = new Date();

  // Mark aged-out failed rows terminal before the drain picks them up.
  // They stop retrying and become scrub candidates on the next pass.
  //
  // SELECT ids with LIMIT first, then UPDATE those exact ids, so a backlog
  // of thousands of aged-out rows (e.g. a one-time sweep after a bug fix)
  // spreads over several ticks instead of holding a heavy table lock.
  const abandonCutoff = new Date(now.getTime() - ABANDON_AGE_DAYS * 24 * 60 * 60 * 1000);
  const abandonCandidates = await db
    .select({ id: lessonEmailOutbox.id })
    .from(lessonEmailOutbox)
    .where(
      and(
        eq(lessonEmailOutbox.status, "failed"),
        lt(lessonEmailOutbox.createdAt, abandonCutoff),
      ),
    )
    .limit(ABANDON_LIMIT_PER_TICK);
  let abandoned = 0;
  if (abandonCandidates.length > 0) {
    const abandonIds = abandonCandidates.map((row) => row.id);
    await db
      .update(lessonEmailOutbox)
      .set({
        status: "abandoned",
        lastError: sql`coalesce(${lessonEmailOutbox.lastError}, 'abandoned_after_retry_window')`,
        claimedUntil: null,
      })
      .where(inArray(lessonEmailOutbox.id, abandonIds));
    abandoned = abandonIds.length;
    log.info({ abandoned }, "lesson-email rows abandoned after retry window");
  }

  const rows = await db
    .select({ id: lessonEmailOutbox.id })
    .from(lessonEmailOutbox)
    .where(
      and(
        or(
          inArray(lessonEmailOutbox.status, ["pending", "failed"]),
          and(
            eq(lessonEmailOutbox.status, "sending"),
            lt(lessonEmailOutbox.claimedUntil, now),
          ),
        ),
        lt(lessonEmailOutbox.nextAttemptAt, now),
      ),
    )
    .orderBy(asc(lessonEmailOutbox.nextAttemptAt))
    .limit(DRAIN_LIMIT_PER_TICK);
  // `now` is passed as a Date → drizzle serializes it via the postgres-js
  // param path; no Date-to-string manual cast needed.

  let drained = 0;
  for (const row of rows) {
    try {
      // Sequential by design — see module header. The sender swallows its
      // own errors, so this await should never throw in practice.
      await sendLessonEmailOutboxRow(row.id);
      drained++;
    } catch (err) {
      log.error(
        { outboxId: row.id, err: err instanceof Error ? err.message : String(err) },
        "sender threw past its catch — continuing drain",
      );
    }
  }
  return { drained, abandoned };
}

export async function scrubLessonEmailPayloads(): Promise<ScrubResult> {
  const cutoff = new Date(Date.now() - SCRUB_AGE_DAYS * 24 * 60 * 60 * 1000);
  // TODO(account-deletion): ADR 028 requires that account deletion also
  // clears outbox rows for the household being deleted. When the deletion
  // flow lands, add a `DELETE FROM lesson_email_outbox WHERE lesson_id IN
  // (SELECT id FROM lessons WHERE household_id = :h)` call to the
  // deletion transaction and wire a reminder into docs/accounts.md. This
  // scrub only handles time-based retention and does not know about
  // account deletion.
  //
  // Target: terminal rows older than 30 days whose payload still carries
  // render inputs. The jsonb `? 'swimmerFirstNames'` operator keeps the
  // pass idempotent — a second run touches no rows.
  //
  // SELECT the ids first with LIMIT applied, then UPDATE those exact ids.
  // Doing it this way avoids wedging a correlated subquery inside the
  // UPDATE's WHERE clause.
  const candidateRows = await db
    .select({ id: lessonEmailOutbox.id })
    .from(lessonEmailOutbox)
    .where(
      and(
        inArray(lessonEmailOutbox.status, ["sent", "skipped", "superseded", "abandoned"]),
        // coalesce(...) is a bare SQL expression with no column context,
        // so postgres-js can't infer how to serialize the Date on its
        // own — cast to text ISO so the comparison runs in SQL.
        sql`coalesce(${lessonEmailOutbox.sentAt}, ${lessonEmailOutbox.lastAttemptAt}, ${lessonEmailOutbox.updatedAt}) < ${cutoff.toISOString()}::timestamptz`,
        sql`${lessonEmailOutbox.payload} ? 'swimmerFirstNames'`,
      ),
    )
    .limit(SCRUB_LIMIT_PER_TICK);

  if (candidateRows.length === 0) {
    return { scrubbed: 0 };
  }

  const ids = candidateRows.map((row) => row.id);
  await db
    .update(lessonEmailOutbox)
    .set({ payload: sql`jsonb_build_object('_scrubbed_at', now())` })
    .where(inArray(lessonEmailOutbox.id, ids));

  return { scrubbed: ids.length };
}
