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
import { db } from "../../db/client";
import { lessonEmailOutbox, lessons, profiles } from "../../db/schema";
import { getEnv } from "../../lib/env";
import { logger as rootLogger } from "../../logger";
import { buildIcs } from "./ics";
import { renderEmail } from "./render";
import { createTransport, type EmailTransport, type IcsAttachment, type TransportError } from "./transport";
import type { IcsMethod, LessonEmailEvent, LessonEmailPayload } from "./types";

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

export function __resetSenderTransportForTests(): void {
  cachedTransport = undefined;
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
  cachedTransport = createTransport(emailEnv);
  return cachedTransport;
}

export async function sendLessonEmailOutboxRow(outboxId: string): Promise<void> {
  try {
    await sendInner(outboxId);
  } catch (err) {
    // Last-chance safety net. Anything that escapes sendInner's own
    // handlers lands here so no exception reaches the microtask queue
    // or the cron response.
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
  const rendered = renderEmail(claimed.event, payload);
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
  log.warn(
    {
      outboxId,
      lessonId: claimed.lessonId,
      event: claimed.event,
      transport: emailEnv.transport,
      attempts: claimed.attempts + 1,
      errorKind: result.error?.kind,
      lastError: result.errorMessage,
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
  // Newer-already-sent check: applies to every event, including CANCEL.
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

function shortError(err: unknown): string {
  if (err instanceof Error) return `${err.name}:${err.message}`.slice(0, 200);
  return String(err).slice(0, 200);
}
