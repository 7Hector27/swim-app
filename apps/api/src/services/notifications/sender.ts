// Coach push notification sender. Entry point used by both the post-
// commit microtask hook (per-row, immediate) and the cron drain
// (sequential, capped). See ADR 031 and docs/plans/coach-alerts.md.
//
// Flow:
// 1. Claim the row (FOR UPDATE SKIP LOCKED, 2-min lease, push_status='sending').
// 2. Pre-send supersede guard.
// 3. Quiet-hours check: if the alert fails the 12-hour-starts_at bypass
//    AND quiet hours are on AND we're in the window → flip to 'held' with
//    release_at = next quiet_hours_end_local in LA.
// 4. Load active subscriptions. If zero → email-backup branch or 'skipped'.
// 5. Fan out per subscription. 404/410 deactivates the subscription;
//    everything else fails the row with backoff and leaves subscriptions
//    intact.
// 6. Finalize the row.
//
// Never throws past its own catches.

import { and, eq, gt, inArray, isNotNull, lt, or, sql } from "drizzle-orm";

import { db } from "../../db/client";
import {
  coachNotifications,
  coachPushSubscriptions,
  lessonEmailOutbox,
  lessons,
  profiles,
} from "../../db/schema";
import { logger as rootLogger } from "../../logger";
import { getOrCreateCoachNotificationPreferences } from "./preferences";
import {
  createPushTransport,
  type PushTransport,
} from "./pushTransport";
import { renderPushBody } from "./renderPushBody";
import type {
  CoachNotificationCategory,
  CoachNotificationPayload,
  CoachNotificationPushStatus,
  CoachNotificationUrgency,
} from "./types";
import { isInsideQuietHours, nextLaWallTimeAfter } from "./quietHours";
import { shouldBypassQuietHours } from "./urgency";

// 2-minute claim lease, matching lesson_email_outbox.
export const PUSH_CLAIM_LEASE_MS = 2 * 60 * 1000;
const MAX_BACKOFF_MINUTES = 30;

const log = rootLogger.child({ component: "coach-notification-sender" });

let cachedTransport: PushTransport | null | undefined;

export function __resetSenderForTests(): void {
  cachedTransport = undefined;
}

export function __setSenderTransportForTests(transport: PushTransport | null): void {
  cachedTransport = transport;
}

function getTransport(): PushTransport | null {
  if (cachedTransport !== undefined) return cachedTransport;
  cachedTransport = createPushTransport();
  if (!cachedTransport) {
    log.warn(
      "coach-notification sender: VAPID env not set, sender is a no-op",
    );
  }
  return cachedTransport;
}

interface ClaimedRow {
  id: string;
  profileId: string;
  category: CoachNotificationCategory;
  urgency: CoachNotificationUrgency;
  lessonId: string | null;
  batchId: string | null;
  payload: CoachNotificationPayload;
  clickUrl: string;
  tag: string;
  attempts: number;
  createdAt: Date;
}

export async function sendCoachNotification(notificationId: string): Promise<void> {
  try {
    await sendInner(notificationId);
  } catch (err) {
    log.error(
      { notificationId, err: shortError(err) },
      "coach-notification sender unexpected throw at top level",
    );
    try {
      await finalizeFailed(notificationId, "unexpected", shortError(err));
    } catch (persistErr) {
      log.error(
        { notificationId, err: shortError(persistErr) },
        "coach-notification finalize also failed",
      );
    }
  }
}

async function sendInner(notificationId: string): Promise<void> {
  // ── Step 1: claim ────────────────────────────────────────────────────
  const claimed = await claimRow(notificationId);
  if (!claimed) return;

  // ── Step 2: supersede guard ──────────────────────────────────────────
  const supersede = await evaluateSupersede(claimed);
  if (supersede !== null) {
    await finalizeTerminal(notificationId, "superseded", `superseded:${supersede}`);
    log.info(
      { notificationId, category: claimed.category, reason: supersede },
      "coach-notification superseded",
    );
    return;
  }

  // ── Step 3: quiet-hours check ────────────────────────────────────────
  const prefs = await getOrCreateCoachNotificationPreferences(claimed.profileId);
  const categoryEnabled = isCategoryEnabled(claimed.category, prefs);
  if (!categoryEnabled) {
    await finalizeTerminal(notificationId, "skipped", "category_disabled");
    log.info(
      { notificationId, category: claimed.category },
      "coach-notification skipped (category disabled)",
    );
    return;
  }

  // Resolve the affected lesson's starts_at for the 12-hour bypass check.
  // Null for calendar_disconnected / daily_summary (no lesson).
  const lessonStartsAt = claimed.lessonId
    ? await loadLessonStartsAt(claimed.lessonId)
    : null;

  const bypass = shouldBypassQuietHours(lessonStartsAt, claimed.urgency);
  if (!bypass && isInsideQuietHours(
    new Date(),
    prefs.quietHoursStartLocal,
    prefs.quietHoursEndLocal,
    prefs.quietHoursEnabled,
  )) {
    const releaseAt = nextLaWallTimeAfter(new Date(), prefs.quietHoursEndLocal);
    await finalizeHeld(notificationId, releaseAt);
    log.info(
      { notificationId, category: claimed.category, releaseAt: releaseAt.toISOString() },
      "coach-notification held (quiet hours)",
    );
    return;
  }

  // ── Step 4: load subscriptions ───────────────────────────────────────
  const subscriptions = await loadActiveSubscriptions(claimed.profileId);
  if (subscriptions.length === 0) {
    // Email-backup branch for single-lesson booking requests only. Batch
    // alerts don't get a backup email — one 20-row summary email is noise
    // and the batch itself appears in the next daily summary. Scoping the
    // backup to lesson_id-bearing rows also keeps the backup outbox row's
    // FK blast radius narrower.
    if (
      claimed.category === "booking_request" &&
      claimed.lessonId !== null &&
      prefs.bookingRequestEmailBackupEnabled
    ) {
      await enqueueCoachBookingEmailBackup(claimed);
      await finalizeTerminal(
        notificationId,
        "skipped",
        "no_active_subscriptions:email_backup_queued",
      );
      log.info(
        { notificationId, category: claimed.category },
        "coach-notification skipped, email backup queued",
      );
      return;
    }
    await finalizeTerminal(notificationId, "skipped", "no_active_subscriptions");
    log.info(
      { notificationId, category: claimed.category },
      "coach-notification skipped (no active subscriptions)",
    );
    return;
  }

  // ── Step 5: render + fan-out ────────────────────────────────────────
  const transport = getTransport();
  if (!transport) {
    await finalizeTerminal(notificationId, "skipped", "transport_not_configured");
    return;
  }

  const rendered = renderPushBody(claimed.payload, prefs.lockScreenDetail);
  const pushBody = {
    title: rendered.title,
    body: rendered.body,
    tag: claimed.tag,
    click_url: claimed.clickUrl,
    urgency: claimed.urgency,
  };

  let deliveredCount = 0;
  let anyFail = false;
  const now = new Date();
  for (const subscription of subscriptions) {
    const result = await transport.send(subscription, pushBody);
    if (result.outcome === "ok") {
      deliveredCount++;
      await db
        .update(coachPushSubscriptions)
        .set({ lastDeliveryAt: now })
        .where(eq(coachPushSubscriptions.id, subscription.id));
    } else if (result.outcome === "gone") {
      await db
        .update(coachPushSubscriptions)
        .set({
          isActive: false,
          removedReason: "gone",
          lastFailureAt: now,
        })
        .where(eq(coachPushSubscriptions.id, subscription.id));
    } else {
      anyFail = true;
      await db
        .update(coachPushSubscriptions)
        .set({ lastFailureAt: now })
        .where(eq(coachPushSubscriptions.id, subscription.id));
      log.error(
        {
          notificationId,
          subscriptionId: subscription.id,
          category: claimed.category,
          statusCode: result.statusCode,
          error: result.shortError,
        },
        "coach-notification push failed (subscription kept active)",
      );
    }
  }

  // ── Step 6: finalize ────────────────────────────────────────────────
  if (deliveredCount > 0) {
    await finalizeSent(notificationId, deliveredCount);
    log.info(
      {
        notificationId,
        category: claimed.category,
        subscriptionCount: subscriptions.length,
        deliveredCount,
      },
      "coach-notification sent",
    );
    return;
  }
  if (anyFail) {
    await finalizeFailed(notificationId, "push_failed", null);
    return;
  }
  // Every subscription returned 404/410. Nothing active left, treat the
  // notification as skipped (not failed — no transient recovery possible).
  await finalizeTerminal(notificationId, "skipped", "all_subscriptions_gone");
}

async function claimRow(notificationId: string): Promise<ClaimedRow | null> {
  const now = new Date();
  return await db.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: coachNotifications.id,
        profileId: coachNotifications.profileId,
        category: coachNotifications.category,
        urgency: coachNotifications.urgency,
        lessonId: coachNotifications.lessonId,
        batchId: coachNotifications.batchId,
        payload: coachNotifications.payload,
        clickUrl: coachNotifications.clickUrl,
        tag: coachNotifications.tag,
        attempts: coachNotifications.pushAttempts,
        createdAt: coachNotifications.createdAt,
      })
      .from(coachNotifications)
      .where(
        and(
          eq(coachNotifications.id, notificationId),
          or(
            inArray(coachNotifications.pushStatus, ["pending", "failed"]),
            and(
              eq(coachNotifications.pushStatus, "sending"),
              lt(coachNotifications.pushClaimedUntil, now),
            ),
          ),
        ),
      )
      .for("update", { skipLocked: true })
      .limit(1);
    const row = rows[0];
    if (!row) return null;

    const leaseUntil = new Date(Date.now() + PUSH_CLAIM_LEASE_MS);
    await tx
      .update(coachNotifications)
      .set({
        pushStatus: "sending",
        pushClaimedUntil: leaseUntil,
        pushLastAttemptAt: now,
      })
      .where(eq(coachNotifications.id, notificationId));

    return {
      id: row.id,
      profileId: row.profileId,
      category: row.category as CoachNotificationCategory,
      urgency: row.urgency as CoachNotificationUrgency,
      lessonId: row.lessonId,
      batchId: row.batchId,
      payload: row.payload as CoachNotificationPayload,
      clickUrl: row.clickUrl,
      tag: row.tag,
      attempts: row.attempts,
      createdAt: row.createdAt,
    };
  });
}

type SupersedeReason = "newer_sent_row" | "past_start_time";

async function evaluateSupersede(row: ClaimedRow): Promise<SupersedeReason | null> {
  // calendar_disconnected and daily_summary have no lesson/batch context.
  // No supersede by lesson progression; a newer calendar_disconnected or
  // daily_summary row for the same tag already dedup-protects via the
  // partial unique index. Skip.
  if (row.category === "calendar_disconnected" || row.category === "daily_summary") {
    return null;
  }

  // Newer-sent-row check: any newer sent row for the same lesson/batch
  // supersedes this one — the follow-up already told the coach the
  // current state.
  if (row.lessonId) {
    const newer = await db
      .select({ id: coachNotifications.id })
      .from(coachNotifications)
      .where(
        and(
          eq(coachNotifications.lessonId, row.lessonId),
          isNotNull(coachNotifications.pushSentAt),
          gt(coachNotifications.createdAt, row.createdAt),
        ),
      )
      .limit(1);
    if (newer[0]) return "newer_sent_row";
  }
  if (row.batchId) {
    const newer = await db
      .select({ id: coachNotifications.id })
      .from(coachNotifications)
      .where(
        and(
          eq(coachNotifications.batchId, row.batchId),
          isNotNull(coachNotifications.pushSentAt),
          gt(coachNotifications.createdAt, row.createdAt),
        ),
      )
      .limit(1);
    if (newer[0]) return "newer_sent_row";
  }

  // Past-start-time check. Parent-change cancel rows are exempt — a late
  // "lesson canceled by parent" still matters.
  if (row.lessonId) {
    const skipPastStart =
      row.category === "parent_change" &&
      row.payload.kind === "parent_change_lesson" &&
      row.payload.changeKind === "canceled";
    if (!skipPastStart) {
      const startsAt = await loadLessonStartsAt(row.lessonId);
      if (startsAt && startsAt.getTime() < Date.now()) {
        return "past_start_time";
      }
    }
  }

  return null;
}

async function loadLessonStartsAt(lessonId: string): Promise<Date | null> {
  const rows = await db
    .select({ startsAt: lessons.startsAt })
    .from(lessons)
    .where(eq(lessons.id, lessonId))
    .limit(1);
  return rows[0]?.startsAt ?? null;
}

async function loadActiveSubscriptions(profileId: string) {
  return await db
    .select({
      id: coachPushSubscriptions.id,
      endpoint: coachPushSubscriptions.endpoint,
      p256dh: coachPushSubscriptions.p256dh,
      auth: coachPushSubscriptions.auth,
    })
    .from(coachPushSubscriptions)
    .where(
      and(
        eq(coachPushSubscriptions.profileId, profileId),
        eq(coachPushSubscriptions.isActive, true),
      ),
    );
}

async function enqueueCoachBookingEmailBackup(row: ClaimedRow): Promise<void> {
  // The lesson_email_outbox requires lesson_id XOR batch_id — exactly one.
  // We also need to compute the next (lesson_id, event, sequence) tuple
  // for dedup. For booking_request → coach_booking_request, there is
  // never a prior row (the sender only reaches this branch when the push
  // row's status flips from pending for the first time), but the index
  // is strict — compute max+1 defensively.
  const scope =
    row.lessonId !== null
      ? { lessonId: row.lessonId, batchId: null as string | null }
      : { lessonId: null as string | null, batchId: row.batchId };
  if (scope.lessonId === null && scope.batchId === null) return;

  // Resolve coach's profile row.
  const coachRow = await db
    .select({ email: profiles.email, emailVerifiedAt: profiles.emailVerifiedAt })
    .from(profiles)
    .where(eq(profiles.id, row.profileId))
    .limit(1);
  const coach = coachRow[0];
  if (!coach?.email || !coach.emailVerifiedAt) {
    // Coach has no verified email → no backup channel. Silently skip —
    // the alert row itself is still being marked skipped by the caller.
    return;
  }

  const sequenceCol = scope.lessonId
    ? eq(lessonEmailOutbox.lessonId, scope.lessonId)
    : eq(lessonEmailOutbox.batchId, scope.batchId!);
  const existingRows = await db
    .select({ sequence: lessonEmailOutbox.sequence })
    .from(lessonEmailOutbox)
    .where(and(sequenceCol, eq(lessonEmailOutbox.event, "coach_booking_request")));
  const nextSequence =
    existingRows.reduce((max, r) => Math.max(max, r.sequence), 0) + 1;

  await db.insert(lessonEmailOutbox).values({
    lessonId: scope.lessonId,
    batchId: scope.batchId,
    event: "coach_booking_request",
    sequence: nextSequence,
    recipientProfileIds: [row.profileId],
    icsMethod: null,
    icsSequence: null,
    payload: row.payload,
  });
}

async function finalizeSent(notificationId: string, deliveredCount: number): Promise<void> {
  await db
    .update(coachNotifications)
    .set({
      pushStatus: "sent",
      pushSentAt: new Date(),
      pushAttempts: sql`${coachNotifications.pushAttempts} + 1` as unknown as number,
      pushLastError: null,
      pushClaimedUntil: null,
      deliveredSubscriptionCount: sql`${coachNotifications.deliveredSubscriptionCount} + ${deliveredCount}` as unknown as number,
    })
    .where(eq(coachNotifications.id, notificationId));
}

async function finalizeHeld(notificationId: string, releaseAt: Date): Promise<void> {
  await db
    .update(coachNotifications)
    .set({
      pushStatus: "held",
      releaseAt,
      pushClaimedUntil: null,
    })
    .where(eq(coachNotifications.id, notificationId));
}

async function finalizeTerminal(
  notificationId: string,
  status: Extract<CoachNotificationPushStatus, "skipped" | "superseded" | "summarized">,
  reason: string,
): Promise<void> {
  await db
    .update(coachNotifications)
    .set({
      pushStatus: status,
      pushLastError: reason,
      pushClaimedUntil: null,
    })
    .where(eq(coachNotifications.id, notificationId));
}

async function finalizeFailed(
  notificationId: string,
  kind: string,
  errorMessage: string | null,
): Promise<void> {
  const existing = await db
    .select({ attempts: coachNotifications.pushAttempts })
    .from(coachNotifications)
    .where(eq(coachNotifications.id, notificationId))
    .limit(1);
  const currentAttempts = existing[0]?.attempts ?? 0;
  const nextAttempts = currentAttempts + 1;
  const backoffMinutes = Math.min(2 ** nextAttempts, MAX_BACKOFF_MINUTES);
  const nextAttemptAt = new Date(Date.now() + backoffMinutes * 60 * 1000);
  await db
    .update(coachNotifications)
    .set({
      pushStatus: "failed",
      pushAttempts: nextAttempts,
      pushLastError: `${kind}:${errorMessage ?? ""}`.slice(0, 500),
      pushNextAttemptAt: nextAttemptAt,
      pushClaimedUntil: null,
    })
    .where(eq(coachNotifications.id, notificationId));
}

function isCategoryEnabled(
  category: CoachNotificationCategory,
  prefs: Awaited<ReturnType<typeof getOrCreateCoachNotificationPreferences>>,
): boolean {
  switch (category) {
    case "booking_request":
      return prefs.bookingRequestEnabled;
    case "request_expiring_soon":
      return prefs.requestExpiringSoonEnabled;
    case "parent_change":
      return prefs.parentChangeEnabled;
    case "auto_approved_summary":
      // 'off' silences; 'summary' and 'immediate' both allow push (the
      // 'summary' mode uses the daily_summary pass to deliver, but we
      // still allow a direct push here if the coach has opted into
      // immediate delivery). The lesson-write path can decide which it
      // enqueues; the sender respects whatever got written.
      return prefs.autoApprovedMode !== "off";
    case "calendar_disconnected":
      return true;
    case "daily_summary":
      return prefs.dailySummaryEnabled;
  }
}

function shortError(err: unknown): string {
  const raw = err instanceof Error ? `${err.name}:${err.message}` : String(err);
  return raw.slice(0, 200);
}
