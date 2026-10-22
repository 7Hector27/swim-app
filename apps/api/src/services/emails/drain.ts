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

const log = rootLogger.child({ component: "lesson-email-drain" });

export interface DrainResult {
  drained: number;
}

export interface ScrubResult {
  scrubbed: number;
}

export async function drainLessonEmailOutbox(): Promise<DrainResult> {
  const now = new Date();
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
  return { drained };
}

export async function scrubLessonEmailPayloads(): Promise<ScrubResult> {
  const cutoff = new Date(Date.now() - SCRUB_AGE_DAYS * 24 * 60 * 60 * 1000);
  // Target: terminal rows older than 30 days whose payload still carries
  // render inputs. The jsonb `? 'swimmerFirstNames'` operator keeps the
  // pass idempotent — a second run touches no rows.
  const result = await db
    .update(lessonEmailOutbox)
    .set({
      payload: sql`jsonb_build_object('_scrubbed_at', now())`,
    })
    .where(
      and(
        inArray(lessonEmailOutbox.status, ["sent", "skipped", "superseded"]),
        lt(
          sql`coalesce(${lessonEmailOutbox.sentAt}, ${lessonEmailOutbox.lastAttemptAt}, ${lessonEmailOutbox.updatedAt})`,
          cutoff,
        ),
        sql`${lessonEmailOutbox.payload} ? 'swimmerFirstNames'`,
        // Belt-and-suspenders cap in case Postgres doesn't short-circuit
        // on the jsonb operator for a huge historical backlog.
        sql`${lessonEmailOutbox.id} IN (
          SELECT id FROM ${lessonEmailOutbox}
          WHERE status IN ('sent','skipped','superseded')
            AND coalesce(sent_at, last_attempt_at, updated_at) < ${cutoff}
            AND payload ? 'swimmerFirstNames'
          LIMIT ${SCRUB_LIMIT_PER_TICK}
        )`,
      ),
    )
    .returning({ id: lessonEmailOutbox.id });
  return { scrubbed: result.length };
}
