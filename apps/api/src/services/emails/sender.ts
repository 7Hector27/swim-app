// Parent booking email sender. Entry point used by both the post-commit
// microtask hook (per-row, immediate) and the cron drain (sequential,
// capped). See ADR 028 and docs/plans/parent-booking-emails.md.
//
// Flow (step numbers match the plan):
// 1. Claim the row with FOR UPDATE SKIP LOCKED (status='sending', 2min lease).
// 2. Pre-send supersede guard (newer sent row, past start time with CANCEL
//    exemption).
// 3. Resolve recipients via the profiles.email mirror.
// 4. Render subject + text body (phase 1 is plain text; phase 2 adds HTML + .ics).
// 5. Call the transport outside any DB transaction, with the outbox id as
//    the Idempotency-Key.
// 6. Finalize in a short second transaction (sent / failed / skipped /
//    superseded) and clear the claim.
//
// The function never throws. Any error becomes a row update with
// last_error set and claimed_until cleared.

import { and, eq, gt, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import { render as renderReactEmail } from "@react-email/render";
import { db } from "../../db/client";
import { lessonEmailOutbox, lessons, profiles } from "../../db/schema";
import { __resetEnvCacheForTests, getEnv } from "../../lib/env";
import { getActiveCoachProfile } from "../../lib/coachProfile";
import { logger as rootLogger } from "../../logger";
import { buildBatchIcs, type BatchIcsFilteredLesson, type BatchIcsMethod } from "./batchIcs";
import type { BatchEmailEvent, BatchEmailPayload } from "./batchTypes";
import {
  buildBulkCancelIcs,
  cancelledLessonToIcsFiltered,
  type BulkCancelIcsFilteredLesson,
} from "./bulkCancelIcs";
import type { BulkCancelEmailPayload } from "./bulkCancelTypes";
import { buildIcs } from "./ics";
import { renderEmail } from "./render";
import type { AccountDeletedEmailPayload } from "./accountDeletedTypes";
import type { BalanceFundedEmailPayload } from "./balanceFundedTypes";
import { formatMoneyCents } from "./templates/shared/copyHelpers";
import Batch from "./templates/Batch";
import BalanceFunded from "./templates/BalanceFunded";
import CoachAccountDeleted from "./templates/CoachAccountDeleted";
import CoachBulkCancel from "./templates/CoachBulkCancel";
import { createTransport, type EmailTransport, type IcsAttachment, type TransportError } from "./transport";
import type { IcsMethod, LessonEmailEvent, LessonEmailPayload } from "./types";

const BATCH_EVENTS: ReadonlySet<string> = new Set([
  "batch_booked",
  "batch_approved",
  "batch_canceled",
]);

// 2-minute claim lease. Covers Resend's p99 latency with ample headroom;
// a longer-than-expected send gets a second worker to re-claim the row
// before Resend would retry, and the Idempotency-Key keeps the second
// send from double-shipping on Resend's side.
export const CLAIM_LEASE_MS = 2 * 60 * 1000;

// Backoff capped at 30 min — plan rule.
const MAX_BACKOFF_MINUTES = 30;

const log = rootLogger.child({ component: "lesson-email-sender" });

// Singleton transport, lazily initialized. Nullable because APP_ENV=local
// without email vars configured is a valid no-op mode.
let cachedTransport: EmailTransport | null | undefined;

// Resets BOTH the sender's memoized transport AND the api env cache. The
// two are coupled: the transport is built from `getEnv().email`, so a test
// that mutates email env vars and only clears the transport cache would
// get a stale transport rebuilt from the stale env. Keep them in lockstep
// here so a future test can't forget the second reset.
export function __resetSenderTransportForTests(): void {
  cachedTransport = undefined;
  __resetEnvCacheForTests();
}

export function __setSenderTransportForTests(transport: EmailTransport | null): void {
  cachedTransport = transport;
}

function getTransport(): EmailTransport | null {
  if (cachedTransport !== undefined) return cachedTransport;
  const emailEnv = getEnv().email;
  if (!emailEnv) {
    cachedTransport = null;
    return null;
  }
  const transport = createTransport(emailEnv);
  if (!transport) {
    // Deployed envs can't reach here — env.ts rejects a resend transport
    // without RESEND_API_KEY and a smtp transport without host/port. Only
    // APP_ENV=local can land here, by picking a transport but omitting the
    // credential (e.g. EMAIL_TRANSPORT=resend without RESEND_API_KEY).
    // The memoized `null` means the warning fires exactly once per boot.
    log.warn(
      { transport: emailEnv.transport },
      "lesson-email createTransport returned null (missing credential for the chosen transport)",
    );
  }
  cachedTransport = transport;
  return cachedTransport;
}

export async function sendLessonEmailOutboxRow(outboxId: string): Promise<void> {
  try {
    // Peek at the row's scope + event BEFORE claiming so we route to the
    // correct sender path. The claim transactions below also narrow via
    // isNotNull(lesson_id) / isNotNull(batch_id), so a mis-routed call
    // just no-ops (nothing is claimed).
    //
    // coach_booking_request rows are the ADR 031 email backup. The batch
    // variant has lesson_id=null, batch_id!=null — if we routed it to
    // sendBatchInner it would be rejected (BATCH_EVENTS filter) because
    // the payload shape doesn't match the batch_* events. Route all
    // coach_booking_request rows (lesson- or batch-scoped) through the
    // dedicated backup sender instead.
    const peek = await db
      .select({
        event: lessonEmailOutbox.event,
        lessonId: lessonEmailOutbox.lessonId,
        batchId: lessonEmailOutbox.batchId,
      })
      .from(lessonEmailOutbox)
      .where(eq(lessonEmailOutbox.id, outboxId))
      .limit(1);
    const row = peek[0];
    if (!row) return;
    if (row.event === "coach_booking_request") {
      await sendCoachBookingBackupInner(outboxId);
    } else if (row.event === "coach_bulk_cancel") {
      await sendBulkCancelInner(outboxId);
    } else if (row.event === "coach_account_deleted") {
      await sendCoachAccountDeletedInner(outboxId);
    } else if (row.event === "balance_funded") {
      await sendBalanceFundedInner(outboxId);
    } else if (row.lessonId !== null) {
      await sendInner(outboxId);
    } else if (row.batchId !== null) {
      await sendBatchInner(outboxId);
    }
  } catch (err) {
    // Last-chance safety net. Anything that escapes the inner senders'
    // own handlers lands here so no exception reaches the microtask
    // queue or the cron response.
    log.error(
      { outboxId, err: shortError(err) },
      "lesson-email sender unexpected throw at top level",
    );
    try {
      await finalizeFailed(outboxId, "unexpected", shortError(err));
    } catch (persistErr) {
      log.error(
        { outboxId, err: shortError(persistErr) },
        "lesson-email finalize also failed",
      );
    }
  }
}

async function sendInner(outboxId: string): Promise<void> {
  const transport = getTransport();
  if (!transport) {
    // APP_ENV=local without email config. Mark skipped so cron doesn't
    // pile up pending rows.
    await finalizeSkipped(outboxId, "transport_not_configured");
    return;
  }

  // ─── Step 1: claim ────────────────────────────────────────────────────
  const claimed = await claimRow(outboxId);
  if (!claimed) {
    // Another worker owns the claim, or the row is already terminal.
    return;
  }

  // ─── Step 2: supersede guard ──────────────────────────────────────────
  const supersede = await evaluateSupersede(claimed);
  if (supersede !== null) {
    await finalizeTerminal(outboxId, "superseded", `superseded:${supersede}`);
    log.info({ outboxId, lessonId: claimed.lessonId, event: claimed.event, reason: supersede }, "superseded");
    return;
  }

  // ─── Step 3: recipient resolution ─────────────────────────────────────
  const deliverable = await resolveRecipients(claimed.recipientProfileIds);
  if (deliverable.length === 0) {
    await finalizeSkipped(outboxId, "no_deliverable_recipients");
    log.info(
      {
        outboxId,
        lessonId: claimed.lessonId,
        event: claimed.event,
        resolvedCount: 0,
        deliverableCount: 0,
      },
      "skipped (no deliverable recipients)",
    );
    return;
  }

  // ─── Step 4: render ───────────────────────────────────────────────────
  const payload = claimed.payload as LessonEmailPayload;
  const rendered = await renderEmail(claimed.event, payload);
  const ics = buildIcsAttachment(claimed.icsMethod, claimed.icsSequence, payload);

  // ─── Step 5: transport ────────────────────────────────────────────────
  const emailEnv = getEnv().email!;
  const result = await transport.send({
    from: emailEnv.from,
    replyTo: emailEnv.replyTo,
    to: deliverable,
    subject: rendered.subject,
    text: rendered.text,
    ...(rendered.html && { html: rendered.html }),
    ...(ics && { ics }),
    idempotencyKey: outboxId,
  });

  // ─── Step 6: finalize ─────────────────────────────────────────────────
  if (result.ok) {
    await finalizeSent(outboxId, result.providerMessageId);
    log.info(
      {
        outboxId,
        lessonId: claimed.lessonId,
        event: claimed.event,
        deliverableCount: deliverable.length,
        attempts: claimed.attempts + 1,
        providerMessageId: result.providerMessageId,
        transport: emailEnv.transport,
      },
      "sent",
    );
    return;
  }

  await finalizeFailed(outboxId, result.error?.kind ?? "unexpected", result.errorMessage);
  // Don't echo result.errorMessage into the log line — Resend's error
  // messages sometimes include the recipient address or body fragments,
  // and the DB row's last_error already preserves the full detail for
  // debugging. errorKind is enough for triage.
  log.warn(
    {
      outboxId,
      lessonId: claimed.lessonId,
      event: claimed.event,
      transport: emailEnv.transport,
      attempts: claimed.attempts + 1,
      errorKind: result.error?.kind,
    },
    "lesson-email send failed",
  );
}

// ─── Row-level helpers ──────────────────────────────────────────────────

interface ClaimedRow {
  id: string;
  lessonId: string;
  event: LessonEmailEvent;
  recipientProfileIds: string[];
  icsMethod: "REQUEST" | "CANCEL" | null;
  icsSequence: number | null;
  payload: unknown;
  attempts: number;
  createdAt: Date;
}

function buildIcsAttachment(
  method: IcsMethod | null,
  sequence: number | null,
  payload: LessonEmailPayload,
): IcsAttachment | null {
  if (method === null || sequence === null) return null;
  const built = buildIcs({ method, sequence, payload });
  return { filename: built.filename, content: built.body, method };
}

async function claimRow(outboxId: string): Promise<ClaimedRow | null> {
  const nowAtClaim = new Date();
  return await db.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: lessonEmailOutbox.id,
        lessonId: lessonEmailOutbox.lessonId,
        event: lessonEmailOutbox.event,
        recipientProfileIds: lessonEmailOutbox.recipientProfileIds,
        icsMethod: lessonEmailOutbox.icsMethod,
        icsSequence: lessonEmailOutbox.icsSequence,
        payload: lessonEmailOutbox.payload,
        status: lessonEmailOutbox.status,
        attempts: lessonEmailOutbox.attempts,
        claimedUntil: lessonEmailOutbox.claimedUntil,
        createdAt: lessonEmailOutbox.createdAt,
      })
      .from(lessonEmailOutbox)
      .where(
        and(
          eq(lessonEmailOutbox.id, outboxId),
          // Per-lesson rows only. Batch rows (lessonId IS NULL, batchId
          // IS NOT NULL) are claimed by a parallel sender path in Phase 1C.
          isNotNull(lessonEmailOutbox.lessonId),
          or(
            inArray(lessonEmailOutbox.status, ["pending", "failed"]),
            and(
              eq(lessonEmailOutbox.status, "sending"),
              lt(lessonEmailOutbox.claimedUntil, nowAtClaim),
            ),
          ),
        ),
      )
      .for("update", { skipLocked: true })
      .limit(1);

    const row = rows[0];
    if (!row) return null;
    // Narrowed to per-lesson rows by the isNotNull filter above.
    const lessonId = row.lessonId;
    if (lessonId === null) return null;

    const leaseUntil = new Date(Date.now() + CLAIM_LEASE_MS);
    await tx
      .update(lessonEmailOutbox)
      .set({
        status: "sending",
        claimedUntil: leaseUntil,
        lastAttemptAt: new Date(),
      })
      .where(eq(lessonEmailOutbox.id, outboxId));

    return {
      id: row.id,
      lessonId,
      event: row.event as LessonEmailEvent,
      recipientProfileIds: row.recipientProfileIds,
      icsMethod: (row.icsMethod ?? null) as "REQUEST" | "CANCEL" | null,
      icsSequence: row.icsSequence,
      payload: row.payload,
      attempts: row.attempts,
      createdAt: row.createdAt,
    };
  });
}

type SupersedeReason = "newer_sent_row" | "past_start_time";

async function evaluateSupersede(row: ClaimedRow): Promise<SupersedeReason | null> {
  // Newer-already-sent check.
  //
  // For non-CANCEL rows: any newer sent row for the same lesson supersedes
  // this one — the follow-up already told the parent the current state.
  //
  // For CANCEL rows: only a later REQUEST (strictly higher ics_sequence)
  // supersedes. A plain content email like booking_requested can arrive AFTER
  // a CANCEL (approved→pending reschedule emits CANCEL for the old slot plus
  // booking_requested for the new one) and must NOT prevent the CANCEL from
  // delivering — otherwise the stale invite stays in the parent's calendar.
  if (row.icsMethod === "CANCEL") {
    const newerRequestSent = await db
      .select({ id: lessonEmailOutbox.id })
      .from(lessonEmailOutbox)
      .where(
        and(
          eq(lessonEmailOutbox.lessonId, row.lessonId),
          isNotNull(lessonEmailOutbox.sentAt),
          eq(lessonEmailOutbox.icsMethod, "REQUEST"),
          gt(lessonEmailOutbox.icsSequence, row.icsSequence ?? -1),
        ),
      )
      .limit(1);
    if (newerRequestSent[0]) return "newer_sent_row";
  } else {
    const newerSent = await db
      .select({ id: lessonEmailOutbox.id })
      .from(lessonEmailOutbox)
      .where(
        and(
          eq(lessonEmailOutbox.lessonId, row.lessonId),
          isNotNull(lessonEmailOutbox.sentAt),
          gt(lessonEmailOutbox.createdAt, row.createdAt),
        ),
      )
      .limit(1);
    if (newerSent[0]) return "newer_sent_row";
  }

  // Past-start-time check: CANCEL rows are exempt — their job is to clean
  // a stale invite out of the calendar, and a late CANCEL is still correct.
  if (row.icsMethod !== "CANCEL") {
    const lessonRows = await db
      .select({ startsAt: lessons.startsAt })
      .from(lessons)
      .where(eq(lessons.id, row.lessonId))
      .limit(1);
    const startsAt = lessonRows[0]?.startsAt;
    if (startsAt && startsAt.getTime() < Date.now()) {
      return "past_start_time";
    }
  }

  return null;
}

async function resolveRecipients(profileIds: readonly string[]): Promise<string[]> {
  if (profileIds.length === 0) return [];
  const rows = await db
    .select({ email: profiles.email })
    .from(profiles)
    .where(
      and(
        inArray(profiles.id, profileIds as string[]),
        isNotNull(profiles.email),
        isNotNull(profiles.emailVerifiedAt),
      ),
    );
  // Drizzle types `email` as `text | null` even with isNotNull above —
  // keep the filter to narrow at runtime.
  return rows
    .map((row) => row.email)
    .filter((email): email is string => typeof email === "string" && email.length > 0);
}

async function finalizeSent(outboxId: string, providerMessageId: string | null): Promise<void> {
  await db
    .update(lessonEmailOutbox)
    .set({
      status: "sent",
      sentAt: new Date(),
      attempts: sql`${lessonEmailOutbox.attempts} + 1` as unknown as number,
      lastError: null,
      providerMessageId: providerMessageId,
      claimedUntil: null,
    })
    .where(eq(lessonEmailOutbox.id, outboxId));
}

async function finalizeSkipped(outboxId: string, reason: string): Promise<void> {
  await db
    .update(lessonEmailOutbox)
    .set({
      status: "skipped",
      lastError: reason,
      claimedUntil: null,
    })
    .where(eq(lessonEmailOutbox.id, outboxId));
}

async function finalizeTerminal(
  outboxId: string,
  status: "superseded" | "skipped",
  reason: string,
): Promise<void> {
  await db
    .update(lessonEmailOutbox)
    .set({
      status,
      lastError: reason,
      claimedUntil: null,
    })
    .where(eq(lessonEmailOutbox.id, outboxId));
}

async function finalizeFailed(
  outboxId: string,
  kind: TransportError["kind"] | "unexpected",
  errorMessage: string | null,
): Promise<void> {
  // Read current attempts to compute backoff — doing it in-DB with
  // expression wouldn't let us set next_attempt_at correctly without a
  // round-trip anyway.
  const existing = await db
    .select({ attempts: lessonEmailOutbox.attempts })
    .from(lessonEmailOutbox)
    .where(eq(lessonEmailOutbox.id, outboxId))
    .limit(1);
  const currentAttempts = existing[0]?.attempts ?? 0;
  const nextAttempts = currentAttempts + 1;
  const backoffMinutes = Math.min(2 ** nextAttempts, MAX_BACKOFF_MINUTES);
  const nextAttemptAt = new Date(Date.now() + backoffMinutes * 60 * 1000);

  await db
    .update(lessonEmailOutbox)
    .set({
      status: "failed",
      attempts: nextAttempts,
      lastError: `${kind}:${errorMessage ?? ""}`.slice(0, 500),
      nextAttemptAt,
      claimedUntil: null,
    })
    .where(eq(lessonEmailOutbox.id, outboxId));
}

// ─── Coach booking backup sender (ADR 031) ──────────────────────────────
//
// coach_booking_request rows are the email backup fired when a parent
// submits a (single or batch) booking request and the coach has zero
// active push subscriptions. These rows live in lesson_email_outbox but
// have a different payload shape (CoachNotificationPayload, not
// LessonEmailPayload) and no .ics attachment, so they get their own
// claim/render path instead of flowing through sendInner / sendBatchInner.

interface ClaimedCoachBackupRow {
  id: string;
  lessonId: string | null;
  batchId: string | null;
  event: LessonEmailEvent;
  recipientProfileIds: string[];
  payload: unknown;
  attempts: number;
}

async function claimCoachBackupRow(outboxId: string): Promise<ClaimedCoachBackupRow | null> {
  const nowAtClaim = new Date();
  return await db.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: lessonEmailOutbox.id,
        lessonId: lessonEmailOutbox.lessonId,
        batchId: lessonEmailOutbox.batchId,
        event: lessonEmailOutbox.event,
        recipientProfileIds: lessonEmailOutbox.recipientProfileIds,
        payload: lessonEmailOutbox.payload,
        status: lessonEmailOutbox.status,
        attempts: lessonEmailOutbox.attempts,
        claimedUntil: lessonEmailOutbox.claimedUntil,
      })
      .from(lessonEmailOutbox)
      .where(
        and(
          eq(lessonEmailOutbox.id, outboxId),
          eq(lessonEmailOutbox.event, "coach_booking_request"),
          or(
            inArray(lessonEmailOutbox.status, ["pending", "failed"]),
            and(
              eq(lessonEmailOutbox.status, "sending"),
              lt(lessonEmailOutbox.claimedUntil, nowAtClaim),
            ),
          ),
        ),
      )
      .for("update", { skipLocked: true })
      .limit(1);
    const row = rows[0];
    if (!row) return null;

    const leaseUntil = new Date(Date.now() + CLAIM_LEASE_MS);
    await tx
      .update(lessonEmailOutbox)
      .set({
        status: "sending",
        claimedUntil: leaseUntil,
        lastAttemptAt: new Date(),
      })
      .where(eq(lessonEmailOutbox.id, outboxId));
    return {
      id: row.id,
      lessonId: row.lessonId,
      batchId: row.batchId,
      event: row.event as LessonEmailEvent,
      recipientProfileIds: row.recipientProfileIds,
      payload: row.payload,
      attempts: row.attempts,
    };
  });
}

async function sendCoachBookingBackupInner(outboxId: string): Promise<void> {
  const transport = getTransport();
  if (!transport) {
    await finalizeSkipped(outboxId, "transport_not_configured");
    return;
  }
  const claimed = await claimCoachBackupRow(outboxId);
  if (!claimed) return;

  const deliverable = await resolveRecipients(claimed.recipientProfileIds);
  if (deliverable.length === 0) {
    await finalizeSkipped(outboxId, "no_deliverable_recipients");
    return;
  }

  // The renderEmail dispatch picks the single-lesson vs batch template
  // from payload.kind, so we hand the payload through untouched.
  const rendered = await renderEmail(
    claimed.event,
    claimed.payload as Parameters<typeof renderEmail>[1],
  );

  const emailEnv = getEnv().email!;
  const result = await transport.send({
    from: emailEnv.from,
    replyTo: emailEnv.replyTo,
    to: deliverable,
    subject: rendered.subject,
    text: rendered.text,
    ...(rendered.html && { html: rendered.html }),
    idempotencyKey: outboxId,
  });

  if (result.ok) {
    await finalizeSent(outboxId, result.providerMessageId);
    log.info(
      {
        outboxId,
        scope: claimed.lessonId !== null ? "lesson" : "batch",
        event: claimed.event,
        attempts: claimed.attempts + 1,
        transport: emailEnv.transport,
      },
      "coach-booking-backup sent",
    );
    return;
  }
  await finalizeFailed(outboxId, result.error?.kind ?? "unexpected", result.errorMessage);
  log.warn(
    {
      outboxId,
      scope: claimed.lessonId !== null ? "lesson" : "batch",
      event: claimed.event,
      transport: emailEnv.transport,
      attempts: claimed.attempts + 1,
      errorKind: result.error?.kind,
    },
    "coach-booking-backup send failed",
  );
}

// ─── Batch sender (ADR 030) ─────────────────────────────────────────────

interface ClaimedBatchRow {
  id: string;
  batchId: string;
  event: BatchEmailEvent;
  recipientProfileIds: string[];
  payload: BatchEmailPayload;
  attempts: number;
  createdAt: Date;
}

async function claimBatchRow(outboxId: string): Promise<ClaimedBatchRow | null> {
  const nowAtClaim = new Date();
  return await db.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: lessonEmailOutbox.id,
        batchId: lessonEmailOutbox.batchId,
        event: lessonEmailOutbox.event,
        recipientProfileIds: lessonEmailOutbox.recipientProfileIds,
        payload: lessonEmailOutbox.payload,
        status: lessonEmailOutbox.status,
        attempts: lessonEmailOutbox.attempts,
        claimedUntil: lessonEmailOutbox.claimedUntil,
        createdAt: lessonEmailOutbox.createdAt,
      })
      .from(lessonEmailOutbox)
      .where(
        and(
          eq(lessonEmailOutbox.id, outboxId),
          isNotNull(lessonEmailOutbox.batchId),
          or(
            inArray(lessonEmailOutbox.status, ["pending", "failed"]),
            and(
              eq(lessonEmailOutbox.status, "sending"),
              lt(lessonEmailOutbox.claimedUntil, nowAtClaim),
            ),
          ),
        ),
      )
      .for("update", { skipLocked: true })
      .limit(1);

    const row = rows[0];
    if (!row) return null;
    const batchId = row.batchId;
    if (batchId === null) return null;
    if (!BATCH_EVENTS.has(row.event)) return null;

    const leaseUntil = new Date(Date.now() + CLAIM_LEASE_MS);
    await tx
      .update(lessonEmailOutbox)
      .set({
        status: "sending",
        claimedUntil: leaseUntil,
        lastAttemptAt: new Date(),
      })
      .where(eq(lessonEmailOutbox.id, outboxId));

    return {
      id: row.id,
      batchId,
      event: row.event as BatchEmailEvent,
      recipientProfileIds: row.recipientProfileIds,
      payload: row.payload as BatchEmailPayload,
      attempts: row.attempts,
      createdAt: row.createdAt,
    };
  });
}

type BatchSupersedeReason =
  | "newer_sent_batch_row"
  | "all_lessons_terminal_or_past"
  | "zero_eligible_after_filter";

async function evaluateBatchSupersede(
  row: ClaimedBatchRow,
  liveLessons: Map<string, { status: string; startsAt: Date; calendarSequence: number }>,
): Promise<BatchSupersedeReason | null> {
  // Newer-already-sent check for the same batch_id. Any newer sent batch
  // row supersedes this one (noise-prevention).
  const newerSent = await db
    .select({ id: lessonEmailOutbox.id })
    .from(lessonEmailOutbox)
    .where(
      and(
        eq(lessonEmailOutbox.batchId, row.batchId),
        isNotNull(lessonEmailOutbox.sentAt),
        gt(lessonEmailOutbox.createdAt, row.createdAt),
      ),
    )
    .limit(1);
  if (newerSent[0]) return "newer_sent_batch_row";

  // "All terminal or past" check — only for non-CANCEL rows. CANCEL rows
  // are allowed to send past start time (same ADR 028 exemption).
  if (row.event !== "batch_canceled") {
    const nowMs = Date.now();
    const terminalStatuses = new Set([
      "canceled",
      "declined",
      "expired",
      "no_show",
    ]);
    let anyActiveFuture = false;
    for (const lesson of row.payload.lessons) {
      const live = liveLessons.get(lesson.lessonId);
      if (!live) continue; // lesson row deleted? shouldn't happen (RESTRICT); skip
      const isTerminal = terminalStatuses.has(live.status);
      const isPast = live.startsAt.getTime() < nowMs;
      if (!isTerminal && !isPast) {
        anyActiveFuture = true;
        break;
      }
    }
    if (!anyActiveFuture) return "all_lessons_terminal_or_past";
  }

  return null;
}

interface SendTimeFilterResult {
  // Lessons that passed every filter check (eligible for a VEVENT).
  kept: BatchIcsFilteredLesson[];
  // Lesson ids that were in the payload but failed the filter.
  changedLessonIds: string[];
}

function applySendTimeFilter(
  row: ClaimedBatchRow,
  liveLessons: Map<string, { status: string; startsAt: Date; calendarSequence: number }>,
  nowMs: number,
): SendTimeFilterResult {
  const kept: BatchIcsFilteredLesson[] = [];
  const changedLessonIds: string[] = [];
  for (const lesson of row.payload.lessons) {
    const live = liveLessons.get(lesson.lessonId);
    if (!live) {
      changedLessonIds.push(lesson.lessonId);
      continue;
    }
    // "calendar_sequence still matches the payload snapshot" means the
    // lesson has not been bumped past the one-step bump our own write did.
    // After our write, the lesson's sequence is snapshot + 1. If anything
    // bumped it further, the sequence is snapshot + 2 or more.
    const expectedSequence = lesson.calendarSequence + 1;
    const sequenceMatches = live.calendarSequence === expectedSequence;
    if (!sequenceMatches) {
      changedLessonIds.push(lesson.lessonId);
      continue;
    }
    if (row.event === "batch_canceled") {
      if (live.status !== "canceled") {
        changedLessonIds.push(lesson.lessonId);
        continue;
      }
      // For batch_canceled, only lessons that had a prior invite produce a
      // VEVENT. Pending-only lessons stay in the payload (so the template
      // can list them in the body) but are skipped here. See ADR 030.
      if (lesson.wasInvited === false) {
        continue;
      }
    } else {
      // batch_booked, batch_approved: must still be approved and upcoming.
      if (live.status !== "approved" || live.startsAt.getTime() <= nowMs) {
        changedLessonIds.push(lesson.lessonId);
        continue;
      }
    }
    kept.push({
      lessonId: lesson.lessonId,
      startsAtUtc: lesson.startsAtUtc,
      durationMinutes: lesson.durationMinutes,
      calendarSequence: lesson.calendarSequence,
    });
  }
  return { kept, changedLessonIds };
}

async function sendBatchInner(outboxId: string): Promise<void> {
  const transport = getTransport();
  if (!transport) {
    await finalizeSkipped(outboxId, "transport_not_configured");
    return;
  }

  const claimed = await claimBatchRow(outboxId);
  if (!claimed) return;

  // Live-load every lesson in the batch for both the supersede check and
  // the send-time filter.
  const lessonIds = claimed.payload.lessons.map((l) => l.lessonId);
  const liveRows = lessonIds.length === 0
    ? []
    : await db
        .select({
          id: lessons.id,
          status: lessons.status,
          startsAt: lessons.startsAt,
          calendarSequence: lessons.calendarSequence,
        })
        .from(lessons)
        .where(inArray(lessons.id, lessonIds));
  const liveLessons = new Map(
    liveRows.map((row) => [
      row.id,
      {
        status: row.status as string,
        startsAt: row.startsAt,
        calendarSequence: row.calendarSequence,
      },
    ]),
  );

  const supersede = await evaluateBatchSupersede(claimed, liveLessons);
  if (supersede !== null) {
    await finalizeTerminal(outboxId, "superseded", `superseded:${supersede}`);
    log.info(
      { outboxId, batchId: claimed.batchId, event: claimed.event, reason: supersede },
      "batch email superseded",
    );
    return;
  }

  const deliverable = await resolveRecipients(claimed.recipientProfileIds);
  if (deliverable.length === 0) {
    await finalizeSkipped(outboxId, "no_deliverable_recipients");
    log.info(
      {
        outboxId,
        batchId: claimed.batchId,
        event: claimed.event,
        resolvedCount: 0,
        deliverableCount: 0,
      },
      "batch email skipped (no deliverable recipients)",
    );
    return;
  }

  const filter = applySendTimeFilter(claimed, liveLessons, Date.now());

  // Supersede when the filter leaves no eligible lessons AND the body
  // would be empty — treats "every lesson changed since we wrote the row"
  // as noise.
  if (filter.kept.length === 0 && filter.changedLessonIds.length === claimed.payload.lessons.length) {
    await finalizeTerminal(
      outboxId,
      "superseded",
      "superseded:zero_eligible_after_filter",
    );
    log.info(
      { outboxId, batchId: claimed.batchId, event: claimed.event },
      "batch email superseded (zero eligible after filter)",
    );
    return;
  }

  const coachFirstName = (await getActiveCoachProfile())?.firstName ?? null;
  const siteUrl = getEnv().siteUrl;
  const replyToEmail = getEnv().email?.replyTo ?? null;
  const element = Batch({
    event: claimed.event,
    payload: claimed.payload,
    siteUrl,
    replyToEmail,
    changedLessonIds: filter.changedLessonIds,
    coachFirstName,
  });
  const [html, text] = await Promise.all([
    renderReactEmail(element),
    renderReactEmail(element, { plainText: true }),
  ]);
  const subject = buildBatchSubject(claimed.event, claimed.payload, filter.kept.length);

  const method: BatchIcsMethod | null =
    claimed.event === "batch_canceled" ? "CANCEL" : "REQUEST";
  const ics =
    filter.kept.length > 0
      ? buildBatchIcs({
          method,
          payload: claimed.payload,
          lessons: filter.kept,
        })
      : null;

  const emailEnv = getEnv().email!;
  const result = await transport.send({
    from: emailEnv.from,
    replyTo: emailEnv.replyTo,
    to: deliverable,
    subject,
    text,
    ...(html && { html }),
    ...(ics && {
      ics: {
        filename: ics.filename,
        content: ics.body,
        method,
      } satisfies IcsAttachment,
    }),
    idempotencyKey: outboxId,
  });

  if (result.ok) {
    await finalizeSent(outboxId, result.providerMessageId);
    log.info(
      {
        outboxId,
        batchId: claimed.batchId,
        event: claimed.event,
        deliverableCount: deliverable.length,
        attempts: claimed.attempts + 1,
        providerMessageId: result.providerMessageId,
        transport: emailEnv.transport,
        veventCount: ics?.eventCount ?? 0,
        changedCount: filter.changedLessonIds.length,
      },
      "batch email sent",
    );
    return;
  }

  await finalizeFailed(outboxId, result.error?.kind ?? "unexpected", result.errorMessage);
  log.warn(
    {
      outboxId,
      batchId: claimed.batchId,
      event: claimed.event,
      transport: emailEnv.transport,
      attempts: claimed.attempts + 1,
      errorKind: result.error?.kind,
    },
    "batch email send failed",
  );
}

function buildBatchSubject(
  event: BatchEmailEvent,
  payload: BatchEmailPayload,
  keptCount: number,
): string {
  const poolName = payload.location.name;
  const modeWord = payload.mode === "weekly" ? "weekly " : "";
  const approvedCount = payload.lessons.filter((l) => l.status === "approved").length;
  const pendingCount = payload.lessons.filter((l) => l.status === "pending").length;
  const canceledCount = payload.lessons.filter((l) => l.status === "canceled").length;
  if (event === "batch_booked") {
    if (pendingCount === 0) {
      return `Your ${approvedCount} ${modeWord}${approvedCount === 1 ? "lesson" : "lessons"} at ${poolName} are booked`;
    }
    if (approvedCount === 0) {
      return `Request received: ${pendingCount} ${modeWord}${pendingCount === 1 ? "lesson" : "lessons"} at ${poolName}`;
    }
    return `${approvedCount + pendingCount} ${modeWord}lessons at ${poolName}: ${approvedCount} confirmed, ${pendingCount} waiting for Jason`;
  }
  if (event === "batch_approved") {
    return `Jason confirmed ${approvedCount} ${approvedCount === 1 ? "lesson" : "more lessons"} at ${poolName}`;
  }
  // batch_canceled
  const count = canceledCount || keptCount;
  return `${count} ${count === 1 ? "lesson" : "lessons"} at ${poolName} canceled`;
}

// ─── Bulk-cancel sender (ADR 033) ───────────────────────────────────────

interface ClaimedBulkCancelRow {
  id: string;
  bulkCancellationId: string;
  householdId: string;
  recipientProfileIds: string[];
  icsMethod: IcsMethod | null;
  payload: BulkCancelEmailPayload;
  attempts: number;
  createdAt: Date;
}

async function claimBulkCancelRow(outboxId: string): Promise<ClaimedBulkCancelRow | null> {
  const nowAtClaim = new Date();
  return await db.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: lessonEmailOutbox.id,
        bulkCancellationId: lessonEmailOutbox.bulkCancellationId,
        householdId: lessonEmailOutbox.householdId,
        recipientProfileIds: lessonEmailOutbox.recipientProfileIds,
        icsMethod: lessonEmailOutbox.icsMethod,
        payload: lessonEmailOutbox.payload,
        status: lessonEmailOutbox.status,
        attempts: lessonEmailOutbox.attempts,
        claimedUntil: lessonEmailOutbox.claimedUntil,
        createdAt: lessonEmailOutbox.createdAt,
      })
      .from(lessonEmailOutbox)
      .where(
        and(
          eq(lessonEmailOutbox.id, outboxId),
          isNotNull(lessonEmailOutbox.bulkCancellationId),
          eq(lessonEmailOutbox.event, "coach_bulk_cancel"),
          or(
            inArray(lessonEmailOutbox.status, ["pending", "failed"]),
            and(
              eq(lessonEmailOutbox.status, "sending"),
              lt(lessonEmailOutbox.claimedUntil, nowAtClaim),
            ),
          ),
        ),
      )
      .for("update", { skipLocked: true })
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const bulkCancellationId = row.bulkCancellationId;
    const householdId = row.householdId;
    if (bulkCancellationId === null || householdId === null) return null;

    const leaseUntil = new Date(Date.now() + CLAIM_LEASE_MS);
    await tx
      .update(lessonEmailOutbox)
      .set({
        status: "sending",
        claimedUntil: leaseUntil,
        lastAttemptAt: new Date(),
      })
      .where(eq(lessonEmailOutbox.id, outboxId));

    return {
      id: row.id,
      bulkCancellationId,
      householdId,
      recipientProfileIds: row.recipientProfileIds,
      icsMethod: (row.icsMethod ?? null) as IcsMethod | null,
      payload: row.payload as BulkCancelEmailPayload,
      attempts: row.attempts,
      createdAt: row.createdAt,
    };
  });
}

async function sendBulkCancelInner(outboxId: string): Promise<void> {
  const transport = getTransport();
  if (!transport) {
    await finalizeSkipped(outboxId, "transport_not_configured");
    return;
  }
  const claimed = await claimBulkCancelRow(outboxId);
  if (!claimed) return;

  const deliverable = await resolveRecipients(claimed.recipientProfileIds);
  if (deliverable.length === 0) {
    await finalizeSkipped(outboxId, "no_deliverable_recipients");
    log.info(
      { outboxId, bulkCancellationId: claimed.bulkCancellationId },
      "bulk-cancel email skipped (no deliverable recipients)",
    );
    return;
  }

  // Filter the ICS to lessons whose live calendar_sequence still matches the
  // payload's pre-bump snapshot + 1 and whose status is actually 'canceled'.
  // Mirrors sendBatchInner's wasInvited / sequence check so a lesson that was
  // rebooked between outbox write and send doesn't fire a stale CANCEL.
  const invitedLessons = claimed.payload.cancelledLessons.filter((lesson) => lesson.wasInvited);
  const lessonIds = invitedLessons.map((lesson) => lesson.lessonId);
  const liveRows = lessonIds.length === 0
    ? []
    : await db
        .select({
          id: lessons.id,
          status: lessons.status,
          calendarSequence: lessons.calendarSequence,
        })
        .from(lessons)
        .where(inArray(lessons.id, lessonIds));
  const liveLessons = new Map(
    liveRows.map((row) => [
      row.id,
      {
        status: row.status as string,
        calendarSequence: row.calendarSequence,
      },
    ]),
  );
  const filteredIcsLessons: BulkCancelIcsFilteredLesson[] = [];
  for (const lesson of invitedLessons) {
    const live = liveLessons.get(lesson.lessonId);
    if (!live) continue;
    if (live.status !== "canceled") continue;
    if (live.calendarSequence !== lesson.calendarSequence + 1) continue;
    filteredIcsLessons.push(cancelledLessonToIcsFiltered(lesson));
  }

  const siteUrl = getEnv().siteUrl;
  const replyToEmail = getEnv().email?.replyTo ?? null;
  const element = CoachBulkCancel({
    payload: claimed.payload,
    siteUrl,
    replyToEmail,
  });
  const [html, text] = await Promise.all([
    renderReactEmail(element),
    renderReactEmail(element, { plainText: true }),
  ]);
  const subject = buildBulkCancelSubject(claimed.payload);
  const ics =
    claimed.icsMethod === "CANCEL" && filteredIcsLessons.length > 0
      ? buildBulkCancelIcs({ lessons: filteredIcsLessons })
      : null;

  const emailEnv = getEnv().email!;
  const result = await transport.send({
    from: emailEnv.from,
    replyTo: emailEnv.replyTo,
    to: deliverable,
    subject,
    text,
    ...(html && { html }),
    ...(ics && {
      ics: {
        filename: ics.filename,
        content: ics.body,
        method: "CANCEL" as const,
      } satisfies IcsAttachment,
    }),
    idempotencyKey: outboxId,
  });

  if (result.ok) {
    await finalizeSent(outboxId, result.providerMessageId);
    log.info(
      {
        outboxId,
        bulkCancellationId: claimed.bulkCancellationId,
        householdId: claimed.householdId,
        deliverableCount: deliverable.length,
        attempts: claimed.attempts + 1,
        providerMessageId: result.providerMessageId,
        transport: emailEnv.transport,
        veventCount: ics?.eventCount ?? 0,
      },
      "bulk-cancel email sent",
    );
    return;
  }
  await finalizeFailed(outboxId, result.error?.kind ?? "unexpected", result.errorMessage);
  log.warn(
    {
      outboxId,
      bulkCancellationId: claimed.bulkCancellationId,
      householdId: claimed.householdId,
      transport: emailEnv.transport,
      attempts: claimed.attempts + 1,
      errorKind: result.error?.kind,
    },
    "bulk-cancel email send failed",
  );
}

function buildBulkCancelSubject(payload: BulkCancelEmailPayload): string {
  const cancelled = payload.cancelledLessons.length;
  const declined = payload.declinedRequests.length;
  const poolClause = payload.locationName !== null ? ` at ${payload.locationName}` : "";
  if (cancelled > 0 && declined === 0) {
    return `${cancelled} ${cancelled === 1 ? "lesson" : "lessons"}${poolClause} canceled`;
  }
  if (cancelled === 0 && declined > 0) {
    return `${declined} ${declined === 1 ? "request" : "requests"}${poolClause} not booked`;
  }
  const total = cancelled + declined;
  return `${total} ${total === 1 ? "lesson" : "lessons"}${poolClause} canceled`;
}

// ─── Coach account-deleted sender (ADR 034) ─────────────────────────────
//
// `coach_account_deleted` rows carry no lesson/batch/bulk-cancellation
// scope — the family is gone. The row's recipient is the active coach
// (resolved at enqueue time), the payload holds freed-slot summaries,
// and the sender renders a stand-alone subject (not the "<prefix>:
// <when>" shape). Always delivers regardless of push settings / quiet
// hours — this is an email channel, and the coach's schedule actually
// changed. The sender just needs to ship the row and finalize it.

interface ClaimedAccountDeletedRow {
  id: string;
  recipientProfileIds: string[];
  payload: AccountDeletedEmailPayload;
  attempts: number;
}

async function claimCoachAccountDeletedRow(
  outboxId: string,
): Promise<ClaimedAccountDeletedRow | null> {
  const nowAtClaim = new Date();
  return await db.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: lessonEmailOutbox.id,
        recipientProfileIds: lessonEmailOutbox.recipientProfileIds,
        payload: lessonEmailOutbox.payload,
        status: lessonEmailOutbox.status,
        attempts: lessonEmailOutbox.attempts,
        claimedUntil: lessonEmailOutbox.claimedUntil,
      })
      .from(lessonEmailOutbox)
      .where(
        and(
          eq(lessonEmailOutbox.id, outboxId),
          eq(lessonEmailOutbox.event, "coach_account_deleted"),
          or(
            inArray(lessonEmailOutbox.status, ["pending", "failed"]),
            and(
              eq(lessonEmailOutbox.status, "sending"),
              lt(lessonEmailOutbox.claimedUntil, nowAtClaim),
            ),
          ),
        ),
      )
      .for("update", { skipLocked: true })
      .limit(1);
    const row = rows[0];
    if (!row) return null;

    const leaseUntil = new Date(Date.now() + CLAIM_LEASE_MS);
    await tx
      .update(lessonEmailOutbox)
      .set({
        status: "sending",
        claimedUntil: leaseUntil,
        lastAttemptAt: new Date(),
      })
      .where(eq(lessonEmailOutbox.id, outboxId));
    return {
      id: row.id,
      recipientProfileIds: row.recipientProfileIds,
      payload: row.payload as AccountDeletedEmailPayload,
      attempts: row.attempts,
    };
  });
}

async function sendCoachAccountDeletedInner(outboxId: string): Promise<void> {
  const transport = getTransport();
  if (!transport) {
    await finalizeSkipped(outboxId, "transport_not_configured");
    return;
  }
  const claimed = await claimCoachAccountDeletedRow(outboxId);
  if (!claimed) return;

  const deliverable = await resolveRecipients(claimed.recipientProfileIds);
  if (deliverable.length === 0) {
    await finalizeSkipped(outboxId, "no_deliverable_recipients");
    log.info({ outboxId }, "coach-account-deleted email skipped (no deliverable recipients)");
    return;
  }

  const siteUrl = getEnv().siteUrl;
  const replyToEmail = getEnv().email?.replyTo ?? null;
  const element = CoachAccountDeleted({
    payload: claimed.payload,
    siteUrl,
    replyToEmail,
  });
  const [html, text] = await Promise.all([
    renderReactEmail(element),
    renderReactEmail(element, { plainText: true }),
  ]);
  const subject = "A family deleted their account";

  const emailEnv = getEnv().email!;
  const result = await transport.send({
    from: emailEnv.from,
    replyTo: emailEnv.replyTo,
    to: deliverable,
    subject,
    text,
    ...(html && { html }),
    idempotencyKey: outboxId,
  });

  if (result.ok) {
    await finalizeSent(outboxId, result.providerMessageId);
    log.info(
      {
        outboxId,
        attempts: claimed.attempts + 1,
        transport: emailEnv.transport,
        cancelledLessonCount: claimed.payload.cancelledLessons.length,
      },
      "coach-account-deleted email sent",
    );
    return;
  }
  await finalizeFailed(outboxId, result.error?.kind ?? "unexpected", result.errorMessage);
  log.warn(
    {
      outboxId,
      transport: emailEnv.transport,
      attempts: claimed.attempts + 1,
      errorKind: result.error?.kind,
    },
    "coach-account-deleted email send failed",
  );
}

// ── balance_funded sender (ADR 036 Phase 7) ────────────────────────────────
//
// Household-scoped row — same claim pattern as coach_account_deleted, but
// the row's event filters the SELECT so a stray coach_account_deleted row
// can't be claimed by this sender.

interface ClaimedBalanceFundedRow {
  id: string;
  recipientProfileIds: string[];
  payload: BalanceFundedEmailPayload;
  attempts: number;
}

async function claimBalanceFundedRow(
  outboxId: string,
): Promise<ClaimedBalanceFundedRow | null> {
  const nowAtClaim = new Date();
  return await db.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: lessonEmailOutbox.id,
        recipientProfileIds: lessonEmailOutbox.recipientProfileIds,
        payload: lessonEmailOutbox.payload,
        attempts: lessonEmailOutbox.attempts,
      })
      .from(lessonEmailOutbox)
      .where(
        and(
          eq(lessonEmailOutbox.id, outboxId),
          eq(lessonEmailOutbox.event, "balance_funded"),
          or(
            inArray(lessonEmailOutbox.status, ["pending", "failed"]),
            and(
              eq(lessonEmailOutbox.status, "sending"),
              lt(lessonEmailOutbox.claimedUntil, nowAtClaim),
            ),
          ),
        ),
      )
      .for("update", { skipLocked: true })
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const leaseUntil = new Date(Date.now() + CLAIM_LEASE_MS);
    await tx
      .update(lessonEmailOutbox)
      .set({
        status: "sending",
        claimedUntil: leaseUntil,
        lastAttemptAt: new Date(),
      })
      .where(eq(lessonEmailOutbox.id, outboxId));
    return {
      id: row.id,
      recipientProfileIds: row.recipientProfileIds,
      payload: row.payload as BalanceFundedEmailPayload,
      attempts: row.attempts,
    };
  });
}

async function sendBalanceFundedInner(outboxId: string): Promise<void> {
  const transport = getTransport();
  if (!transport) {
    await finalizeSkipped(outboxId, "transport_not_configured");
    return;
  }
  const claimed = await claimBalanceFundedRow(outboxId);
  if (!claimed) return;

  const deliverable = await resolveRecipients(claimed.recipientProfileIds);
  if (deliverable.length === 0) {
    await finalizeSkipped(outboxId, "no_deliverable_recipients");
    log.info({ outboxId }, "balance_funded email skipped (no deliverable recipients)");
    return;
  }

  const siteUrl = getEnv().siteUrl;
  const replyToEmail = getEnv().email?.replyTo ?? null;
  const element = BalanceFunded({
    payload: claimed.payload,
    siteUrl,
    replyToEmail,
  });
  const [html, text] = await Promise.all([
    renderReactEmail(element),
    renderReactEmail(element, { plainText: true }),
  ]);
  const totalAdded = claimed.payload.amountPaidCents + claimed.payload.bonusCents;
  const subject = `Balance added: ${formatMoneyCents(totalAdded)}`;

  const emailEnv = getEnv().email!;
  const result = await transport.send({
    from: emailEnv.from,
    replyTo: emailEnv.replyTo,
    to: deliverable,
    subject,
    text,
    ...(html && { html }),
    idempotencyKey: outboxId,
  });

  if (result.ok) {
    await finalizeSent(outboxId, result.providerMessageId);
    log.info(
      {
        outboxId,
        attempts: claimed.attempts + 1,
        transport: emailEnv.transport,
        type: claimed.payload.type,
      },
      "balance_funded email sent",
    );
    return;
  }
  await finalizeFailed(outboxId, result.error?.kind ?? "unexpected", result.errorMessage);
  log.warn(
    {
      outboxId,
      transport: emailEnv.transport,
      attempts: claimed.attempts + 1,
      errorKind: result.error?.kind,
    },
    "balance_funded email send failed",
  );
}

// Rough RFC-5321-ish email match. Strict on the local-part so random
// strings with "@" aren't over-redacted. Case-insensitive isn't needed
// since the character classes already cover both cases. Global so
// multiple addresses in one error string all get replaced.
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export function redactEmails(input: string): string {
  return input.replace(EMAIL_PATTERN, "[email]");
}

// Returns a short, log-safe rendering of an upstream error. Resend / SMTP
// providers sometimes include the recipient address in their error payload
// ("could not deliver to foo@bar.com"); strip anything that looks like an
// email before truncating + logging.
export function shortError(err: unknown): string {
  const raw = err instanceof Error ? `${err.name}:${err.message}` : String(err);
  return redactEmails(raw).slice(0, 200);
}
