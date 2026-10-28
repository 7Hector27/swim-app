// Drain + cron passes for coach push notifications. Called from
// POST /internal/cron/tick. All sequential, bounded, never throw past
// their own internal catches. See ADR 031 and docs/plans/coach-alerts.md.

import { and, asc, between, count, eq, gte, inArray, lt, or, sql } from "drizzle-orm";

import { db } from "../../db/client";
import {
  coachNotifications,
  coachNotificationPreferences,
  coachPushSubscriptions,
  lessonLocations,
  lessons,
  profiles,
} from "../../db/schema";
import { logger as rootLogger } from "../../logger";
import { formatLessonTimeDisplay } from "../emails/format";
import { enqueueCoachNotification } from "./outbox";
import { getOrCreateCoachNotificationPreferences } from "./preferences";
import {
  isInsideQuietHours,
  laDateString,
  laTimeDisplay,
  laTimeIsAtOrPast,
} from "./quietHours";
import { sendCoachNotification } from "./sender";
import type { DailySummaryPayload } from "./types";

const DRAIN_LIMIT_PER_TICK = 50;
const RELEASE_LIMIT_PER_TICK = 200;
const EXPIRING_LIMIT_PER_TICK = 200;
const SCRUB_LIMIT_PER_TICK = 500;
const SCRUB_AGE_DAYS = 30;
const ABANDON_AGE_DAYS = 7;
const ABANDON_LIMIT_PER_TICK = 500;
const DEAD_SUBSCRIPTION_AGE_DAYS = 90;
const DEAD_SUBSCRIPTION_LIMIT_PER_TICK = 500;

const log = rootLogger.child({ component: "coach-notification-drain" });

export interface CoachDrainResult {
  drained: number;
  abandoned: number;
}

export async function drainCoachNotifications(): Promise<CoachDrainResult> {
  const now = new Date();
  // Abandon aged-out failed rows.
  const abandonCutoff = new Date(now.getTime() - ABANDON_AGE_DAYS * 24 * 60 * 60 * 1000);
  const abandonCandidates = await db
    .select({ id: coachNotifications.id })
    .from(coachNotifications)
    .where(
      and(
        eq(coachNotifications.pushStatus, "failed"),
        lt(coachNotifications.createdAt, abandonCutoff),
      ),
    )
    .limit(ABANDON_LIMIT_PER_TICK);
  let abandoned = 0;
  if (abandonCandidates.length > 0) {
    const ids = abandonCandidates.map((row) => row.id);
    await db
      .update(coachNotifications)
      .set({
        pushStatus: "abandoned",
        pushLastError: sql`coalesce(${coachNotifications.pushLastError}, 'abandoned_after_retry_window')`,
        pushClaimedUntil: null,
      })
      .where(inArray(coachNotifications.id, ids));
    abandoned = ids.length;
    log.info({ abandoned }, "coach-notifications abandoned after retry window");
  }

  const rows = await db
    .select({ id: coachNotifications.id })
    .from(coachNotifications)
    .where(
      and(
        or(
          inArray(coachNotifications.pushStatus, ["pending", "failed"]),
          and(
            eq(coachNotifications.pushStatus, "sending"),
            lt(coachNotifications.pushClaimedUntil, now),
          ),
        ),
        lt(coachNotifications.pushNextAttemptAt, now),
      ),
    )
    .orderBy(asc(coachNotifications.pushNextAttemptAt))
    .limit(DRAIN_LIMIT_PER_TICK);

  let drained = 0;
  for (const row of rows) {
    try {
      await sendCoachNotification(row.id);
      drained++;
    } catch (err) {
      log.error(
        { notificationId: row.id, err: err instanceof Error ? err.message : String(err) },
        "coach-notification sender threw past its catch — continuing drain",
      );
    }
  }
  return { drained, abandoned };
}

export interface ReleaseHeldResult {
  releasedToPending: number;
  releasedToSummarized: number;
}

export async function releaseHeldCoachNotifications(): Promise<ReleaseHeldResult> {
  const now = new Date();
  const rows = await db
    .select({
      id: coachNotifications.id,
      profileId: coachNotifications.profileId,
    })
    .from(coachNotifications)
    .where(
      and(
        eq(coachNotifications.pushStatus, "held"),
        lt(coachNotifications.releaseAt, now),
      ),
    )
    .limit(RELEASE_LIMIT_PER_TICK);

  let releasedToPending = 0;
  let releasedToSummarized = 0;
  // Group by profile to minimize preference lookups.
  const byProfile = new Map<string, string[]>();
  for (const row of rows) {
    const existing = byProfile.get(row.profileId) ?? [];
    existing.push(row.id);
    byProfile.set(row.profileId, existing);
  }
  for (const [profileId, ids] of byProfile) {
    const prefs = await getOrCreateCoachNotificationPreferences(profileId);
    if (prefs.dailySummaryEnabled) {
      await db
        .update(coachNotifications)
        .set({
          pushStatus: "summarized",
          releaseAt: null,
          pushClaimedUntil: null,
        })
        .where(inArray(coachNotifications.id, ids));
      releasedToSummarized += ids.length;
    } else {
      await db
        .update(coachNotifications)
        .set({
          pushStatus: "pending",
          releaseAt: null,
          pushNextAttemptAt: now,
        })
        .where(inArray(coachNotifications.id, ids));
      releasedToPending += ids.length;
    }
  }
  if (releasedToPending > 0 || releasedToSummarized > 0) {
    log.info({ releasedToPending, releasedToSummarized }, "coach-notifications released from hold");
  }
  return { releasedToPending, releasedToSummarized };
}

export interface ExpiringRemindersResult {
  enqueued: number;
}

export async function enqueueExpiringRequestReminders(): Promise<ExpiringRemindersResult> {
  const now = new Date();
  const threeHoursFromNow = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const fourHoursFromNow = new Date(now.getTime() + 4 * 60 * 60 * 1000);

  const expiring = await db
    .select({
      id: lessons.id,
      startsAt: lessons.startsAt,
      expiresAt: lessons.expiresAt,
      locationId: lessons.locationId,
    })
    .from(lessons)
    .where(
      and(
        eq(lessons.status, "pending"),
        between(lessons.expiresAt, threeHoursFromNow, fourHoursFromNow),
      ),
    )
    .limit(EXPIRING_LIMIT_PER_TICK);

  if (expiring.length === 0) return { enqueued: 0 };

  // Resolve the single active coach once (small single-coach app).
  const coachRow = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.role, "coach"))
    .limit(1);
  const coachProfileId = coachRow[0]?.id;
  if (!coachProfileId) return { enqueued: 0 };

  const prefs = await getOrCreateCoachNotificationPreferences(coachProfileId);
  // Compute the "shift earlier" target time: 15 min before quiet_hours_start.
  // We use the current LA calendar day's quiet-hours-start as the anchor; the
  // real send-time check in the sender uses live now() anyway.
  let enqueued = 0;
  for (const lesson of expiring) {
    if (!lesson.expiresAt) continue;
    // Normal send time: 3 hours before expires_at.
    const normalSendAt = new Date(lesson.expiresAt.getTime() - 3 * 60 * 60 * 1000);
    const inQuietHoursAtNormal = isInsideQuietHours(
      normalSendAt,
      prefs.quietHoursStartLocal,
      prefs.quietHoursEndLocal,
      prefs.quietHoursEnabled,
    );
    const pushNextAttemptAt = inQuietHoursAtNormal
      ? shiftBeforeQuietHoursStart(normalSendAt, prefs.quietHoursStartLocal)
      : normalSendAt;

    try {
      await db.transaction(async (tx) => {
        await enqueueCoachNotification(tx, {
          coachProfileId,
          category: "request_expiring_soon",
          lessonId: lesson.id,
          expiresAtLocalDisplay: formatLessonTimeDisplay(lesson.expiresAt!),
          pushNextAttemptAt,
        });
      });
      enqueued++;
    } catch (err) {
      // Unique index drops duplicates silently; anything else is logged.
      log.warn(
        { lessonId: lesson.id, err: err instanceof Error ? err.message : String(err) },
        "enqueueExpiringRequestReminders insert failed",
      );
    }
  }
  return { enqueued };
}

// Rough: find the preceding LA wall-time "quiet_hours_start" relative to
// `anchor` and subtract 15 min. If anchor is already before today's start,
// use yesterday's. This is intentionally simple — the sender's quiet-hours
// check uses live-now at send time, so even a slightly-off push_next_attempt_at
// behaves correctly (either the sender sends normally or it holds).
function shiftBeforeQuietHoursStart(anchor: Date, startLocal: string): Date {
  // Fifteen minutes before `startLocal` on the LA day that CONTAINS the
  // anchor. If the resulting UTC is >= anchor, roll back a day.
  const anchorLaDate = laDateString(anchor);
  const [startHh, startMm] = startLocal.split(":");
  const startMinutes = Number(startHh) * 60 + Number(startMm) - 15;
  const normalizedHh = Math.floor(((startMinutes + 24 * 60) % (24 * 60)) / 60);
  const normalizedMm = ((startMinutes + 24 * 60) % (24 * 60)) % 60;
  const [y, m, d] = anchorLaDate.split("-").map(Number);
  const guess = new Date(Date.UTC(y!, (m ?? 1) - 1, d, normalizedHh, normalizedMm, 0, 0));
  // Shift back to UTC by LA offset (same approach as quietHours.ts).
  const offsetMinutes = laOffsetMinutes(guess);
  const resolved = new Date(guess.getTime() + offsetMinutes * 60 * 1000);
  if (resolved.getTime() >= anchor.getTime()) {
    return new Date(resolved.getTime() - 24 * 60 * 60 * 1000);
  }
  return resolved;
}

function laOffsetMinutes(instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "longOffset",
  }).formatToParts(instant);
  const tzName = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(tzName);
  if (!match) return 480;
  const sign = match[1] === "-" ? 1 : -1;
  const hh = Number(match[2] ?? 0);
  const mm = Number(match[3] ?? 0);
  return sign * (hh * 60 + mm);
}

export interface DailySummaryResult {
  inserted: number;
}

export async function composeDailyCoachSummary(): Promise<DailySummaryResult> {
  const now = new Date();
  const dateLocal = laDateString(now);
  // All active coaches with daily_summary_enabled=true.
  const coachRows = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.role, "coach"));
  if (coachRows.length === 0) return { inserted: 0 };

  let inserted = 0;
  for (const coach of coachRows) {
    const prefs = await getOrCreateCoachNotificationPreferences(coach.id);
    if (!prefs.dailySummaryEnabled) continue;
    if (!laTimeIsAtOrPast(now, prefs.dailySummaryTimeLocal)) continue;

    // Compute today's lessons (approved/completed, LA date == today),
    // pending-request count, auto-approved count since the previous
    // summary, and the count of released held alerts in the last 24h.
    const todaysLessons = await db
      .select({
        startsAt: lessons.startsAt,
        locationName: lessonLocations.name,
      })
      .from(lessons)
      .innerJoin(lessonLocations, eq(lessons.locationId, lessonLocations.id))
      .where(
        and(
          inArray(lessons.status, ["approved", "completed"]),
          sql`(${lessons.startsAt} AT TIME ZONE 'America/Los_Angeles')::date = ${dateLocal}::date`,
        ),
      )
      .orderBy(asc(lessons.startsAt));

    const pendingCountRow = await db
      .select({ count: count() })
      .from(lessons)
      .where(eq(lessons.status, "pending"));
    const pendingCount = pendingCountRow[0]?.count ?? 0;

    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const heldAlertRow = await db
      .select({ count: count() })
      .from(coachNotifications)
      .where(
        and(
          eq(coachNotifications.profileId, coach.id),
          eq(coachNotifications.pushStatus, "summarized"),
          gte(coachNotifications.updatedAt, twentyFourHoursAgo),
        ),
      );
    const heldAlertCount = heldAlertRow[0]?.count ?? 0;

    const first = todaysLessons[0];
    const summaryPayload: DailySummaryPayload = {
      kind: "daily_summary",
      listTitle: "Daily summary",
      dateLocal,
      lessonCount: todaysLessons.length,
      firstLessonTimeLocal: first ? laTimeDisplay(first.startsAt) : null,
      firstLessonPoolName: first ? first.locationName : null,
      pendingRequestCount: Number(pendingCount),
      heldAlertCount: Number(heldAlertCount),
    };

    try {
      const result = await db.transaction(async (tx) => {
        return await enqueueCoachNotification(tx, {
          coachProfileId: coach.id,
          category: "daily_summary",
          dailySummaryPayload: summaryPayload,
        });
      });
      if (result.notificationId) inserted++;
    } catch (err) {
      log.warn(
        { coachId: coach.id, err: err instanceof Error ? err.message : String(err) },
        "composeDailyCoachSummary insert failed",
      );
    }
  }
  return { inserted };
}

export interface ScrubCoachResult {
  scrubbed: number;
  deadSubscriptionsPurged: number;
}

export async function scrubCoachNotificationPayloads(): Promise<ScrubCoachResult> {
  const cutoff = new Date(Date.now() - SCRUB_AGE_DAYS * 24 * 60 * 60 * 1000);
  const candidates = await db
    .select({ id: coachNotifications.id })
    .from(coachNotifications)
    .where(
      and(
        inArray(coachNotifications.pushStatus, [
          "sent",
          "skipped",
          "superseded",
          "abandoned",
          "summarized",
        ]),
        sql`coalesce(${coachNotifications.pushSentAt}, ${coachNotifications.pushLastAttemptAt}, ${coachNotifications.updatedAt}) < ${cutoff.toISOString()}::timestamptz`,
        sql`${coachNotifications.payload} ? 'listTitle'`,
      ),
    )
    .limit(SCRUB_LIMIT_PER_TICK);

  let scrubbed = 0;
  if (candidates.length > 0) {
    const ids = candidates.map((row) => row.id);
    await db
      .update(coachNotifications)
      .set({
        payload: sql`jsonb_build_object('_scrubbed_at', now())`,
        clickUrl: "",
      })
      .where(inArray(coachNotifications.id, ids));
    scrubbed = ids.length;
  }

  // Hard-delete dead subscriptions older than 90 days. `last_failure_at`
  // is null for rows that were deactivated via `coach_disabled` (coach
  // removed the device from /account) and never saw a push-service
  // failure, so a bare `lt(lastFailureAt, cutoff)` would ignore them
  // forever. Fall back to `updated_at` (always non-null) via coalesce so
  // the age check applies to every deactivated row regardless of
  // removedReason.
  const deadCutoff = new Date(Date.now() - DEAD_SUBSCRIPTION_AGE_DAYS * 24 * 60 * 60 * 1000);
  const deadRows = await db
    .select({ id: coachPushSubscriptions.id })
    .from(coachPushSubscriptions)
    .where(
      and(
        eq(coachPushSubscriptions.isActive, false),
        sql`coalesce(${coachPushSubscriptions.lastFailureAt}, ${coachPushSubscriptions.updatedAt}) < ${deadCutoff.toISOString()}::timestamptz`,
      ),
    )
    .limit(DEAD_SUBSCRIPTION_LIMIT_PER_TICK);
  let deadSubscriptionsPurged = 0;
  if (deadRows.length > 0) {
    const ids = deadRows.map((row) => row.id);
    await db.delete(coachPushSubscriptions).where(inArray(coachPushSubscriptions.id, ids));
    deadSubscriptionsPurged = ids.length;
  }
  return { scrubbed, deadSubscriptionsPurged };
}

// Re-export so the cron handler can see the full surface area in one import.
export { coachNotificationPreferences };
