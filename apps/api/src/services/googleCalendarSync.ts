// One-way sync from the app's lessons table to the coach's Google Calendar.
// See docs/decisions/027-google-calendar-sync.md and
// docs/plans/google-calendar-sync.md for the full design.
//
// Every lesson route (approve, decline, reschedule, cancel on both coach
// and parent paths), the backfill loop, and the manual retry endpoint call
// the single reconcile function exported here.

import { and, asc, eq, gte, inArray, isNotNull, or, sql } from "drizzle-orm";

import { db } from "../db/client";
import {
  coachCalendarIntegrations,
  lessonLocations,
  lessonSwimmers,
  lessons,
  swimmers,
} from "../db/schema";
import { getActiveCoachProfileId } from "../lib/coachProfile";
import { getEnv } from "../lib/env";
import { logger } from "../logger";
import { decryptToken } from "../lib/tokenEncryption";
import * as googleClient from "./googleCalendarClient";

// Hardcoded per ADR 027.
// TODO: per-coach timezone if we ever expand beyond LA.
const LESSON_TIME_ZONE = "America/Los_Angeles";

// Max reconcile passes before giving up. A single Google call happens per
// pass. If the lesson row's visible state changes while that call is in
// flight (a concurrent reschedule or cancel), we loop and reconcile against
// the new state. Three passes is enough to absorb a one-off race; four
// means something upstream is thrashing the row and we should surface
// instead of chasing it. The deterministic event id makes every pass safe:
// upsert overwrites and delete is idempotent, so an intermediate stale
// write is corrected on the next pass with no permanent harm.
const MAX_RECONCILE_PASSES = 3;

/**
 * Read the lesson's current state and make Google match it. Idempotent;
 * safe to call from any number of paths or in rapid succession. This
 * function MUST NOT reject — callers routinely invoke it via
 * `queueMicrotask(() => void syncLessonToGoogle(id))` where a rejection
 * disappears into Node's unhandledRejection channel and the lesson row
 * silently stays `not_synced` with no feedback to the user. Every uncaught
 * error path falls through to markLessonSyncFailed, or to a last-resort
 * best-effort update if the fallback itself throws.
 */
export async function syncLessonToGoogle(lessonId: string): Promise<void> {
  try {
    await syncLessonToGoogleInner(lessonId);
  } catch (err) {
    // Any error reaching here is a bug (an uncaught code path inside the
    // reconcile loop). Mark the lesson sync_failed with best effort so the
    // UI surfaces it, and swallow — a microtask rejection is useless to
    // anyone. We can't call markLessonSyncFailed without a coachProfileId,
    // so write directly to the lesson row.
    logger.error({ err, lessonId }, "google sync: uncaught error in reconcile");
    try {
      await db
        .update(lessons)
        .set({
          calendarSyncStatus: "sync_failed",
          calendarSyncError: `unexpected_error: ${googleClient.toSafeGoogleError(err).message}`.slice(0, 500),
          calendarSyncAttempts: sql`${lessons.calendarSyncAttempts} + 1`,
        })
        .where(eq(lessons.id, lessonId));
    } catch (innerErr) {
      // Even the fallback write failed. Give up and log — Node won't crash.
      logger.error({ err: innerErr, lessonId }, "google sync: fallback write also failed");
    }
  }
}

async function syncLessonToGoogleInner(lessonId: string): Promise<void> {
  const env = getEnv();
  if (!env.googleOAuth) return;

  // Remembered across loop iterations so the "exhausted passes" failure
  // branch can still find the right coach to log + attribute the failure.
  let coachProfileIdForFailure: string | null = null;

  for (let pass = 1; pass <= MAX_RECONCILE_PASSES; pass++) {
    // loadReconcileContext scopes the integration query to status='active',
    // so a non-null context means the integration is currently serving
    // writes. This short-circuit keeps `invalid_grant` storms (after an
    // out-of-band revoke) from piling up on every lesson row the coach
    // touches.
    const context = await loadReconcileContext(lessonId);
    if (!context) return;
    const { lesson, firstNames, location, integration } = context;
    coachProfileIdForFailure = integration.coachProfileId;

    // Snapshot the fields that drive the Google event body. If any of these
    // changes between now and the end of the Google call, we re-reconcile.
    const snapshot = {
      status: lesson.status,
      startsAtMs: lesson.startsAt.getTime(),
      durationMinutes: lesson.durationMinutes,
      locationId: lesson.locationId,
    };

    const eventId = toGoogleEventId(lesson.id);
    // An event should exist in Google whenever the lesson is in a state
    // the coach wants to see on their calendar — approved or completed.
    // Completed lessons stay on the coach's calendar as history; the cron
    // auto-complete transition and a retry run after the lesson's end
    // time both preserve the event. Deletion is reserved for lessons that
    // genuinely shouldn't appear: declined, canceled, expired, no_show,
    // or a lesson row that no longer exists (handled above via null context).
    const shouldExist =
      lesson.status === "approved" || lesson.status === "completed";

    // Nothing to do when the lesson has never been pushed and no event is
    // expected (pending/declined/canceled/etc. that was never approved).
    if (!shouldExist && !lesson.googleCalendarEventId) {
      return;
    }

    // Token columns are nullable in the schema — a bad migration, a manual
    // DB edit, or a half-applied disconnect could leave status='active' with
    // null cipher material. Treat that as needs_reconnect rather than
    // dereferencing a null and surfacing an unhandled rejection.
    if (
      integration.refreshTokenCiphertext === null ||
      integration.refreshTokenIv === null ||
      integration.refreshTokenTag === null ||
      integration.refreshTokenKeyVersion === null
    ) {
      logger.warn(
        {
          googleError: googleClient.toSafeGoogleError(
            new Error("integration row is active but has null token columns"),
          ),
          lessonId: lesson.id,
        },
        "google sync: active integration with missing token material",
      );
      await markNeedsReconnect(lesson.id, integration.coachProfileId);
      return;
    }

    let accessToken: string;
    try {
      const refreshToken = decryptToken(
        {
          ciphertext: integration.refreshTokenCiphertext,
          iv: integration.refreshTokenIv,
          tag: integration.refreshTokenTag,
          keyVersion: integration.refreshTokenKeyVersion,
        },
        env.googleOAuth.tokenEncryptionKey,
      );
      const refreshed = await googleClient.refreshAccessToken(env.googleOAuth, refreshToken);
      accessToken = refreshed.accessToken;
    } catch (err) {
      if (err instanceof googleClient.GoogleInvalidGrantError) {
        await markNeedsReconnect(lesson.id, integration.coachProfileId);
        return;
      }
      await markLessonSyncFailed(lesson.id, integration.coachProfileId, "token_refresh_failed", err);
      return;
    }

    try {
      if (shouldExist) {
        const body: googleClient.CalendarEventBody = {
          summary: buildSummary(firstNames),
          description: `${env.siteUrl}/coach/lessons/${lesson.id}`,
          location: formatLocation(location),
          startIso: lesson.startsAt.toISOString(),
          endIso: new Date(
            lesson.startsAt.getTime() + lesson.durationMinutes * 60_000,
          ).toISOString(),
          timeZone: LESSON_TIME_ZONE,
        };
        await googleClient.upsertEvent(
          env.googleOAuth,
          accessToken,
          integration.googleCalendarId,
          eventId,
          body,
        );
        // Persist the event id immediately so a drift pass that transitions
        // to !shouldExist can see there's an event to delete. markLessonSynced
        // at the end rewrites this to the same value — a cheap redundancy.
        await db
          .update(lessons)
          .set({ googleCalendarEventId: eventId })
          .where(eq(lessons.id, lesson.id));
      } else {
        await googleClient.deleteEventIdempotent(
          env.googleOAuth,
          accessToken,
          integration.googleCalendarId,
          eventId,
        );
        await db
          .update(lessons)
          .set({ googleCalendarEventId: null })
          .where(eq(lessons.id, lesson.id));
      }
    } catch (err) {
      // 403 (rateLimitExceeded / userRateLimitExceeded) and 429 are
      // retryable: mark the lesson failed for the next pass, keep the
      // integration active. Only invalid_grant on refresh flips to
      // needs_reconnect (handled in the refresh try/catch above).
      const reasonTag = isRetryableGoogleHttpError(err) ? "rate_limited" : "google_api_error";
      await markLessonSyncFailed(lesson.id, integration.coachProfileId, reasonTag, err);
      return;
    }

    // Re-read the lesson. If the key fields changed while the Google call
    // was in flight, our write is stale — loop and reconcile the new state.
    const laterRows = await db
      .select()
      .from(lessons)
      .where(eq(lessons.id, lessonId))
      .limit(1);
    const later = laterRows[0];
    if (!later) return;
    const drifted =
      later.status !== snapshot.status ||
      later.startsAt.getTime() !== snapshot.startsAtMs ||
      later.durationMinutes !== snapshot.durationMinutes ||
      later.locationId !== snapshot.locationId;

    if (!drifted) {
      await markLessonSynced(lesson.id, integration.coachProfileId, {
        googleCalendarEventId: shouldExist ? eventId : null,
      });
      return;
    }
    // else: loop and reconcile against `later` on the next pass.
  }

  // Three passes and state is still moving. Surface it so the coach can see
  // the row in the failed-sync chip and retry when the thrashing stops.
  if (coachProfileIdForFailure !== null) {
    await markLessonSyncFailed(
      lessonId,
      coachProfileIdForFailure,
      "reconcile_unstable",
      new Error(`lesson state changed on each of ${MAX_RECONCILE_PASSES} reconcile passes`),
    );
  }
}

// Light pass cap — a worst-case retry burst shouldn't burn through
// Google's user quota in one tick. 50 lessons × 100ms gap = ~5s per
// batch; small enough to finish inside the 2-minute staleness window.
const LIGHT_PASS_CAP = 50;

export interface LightPassResult {
  attempted: number;
  succeeded: number;
  failed: number;
}

/**
 * Light pass: reconcile a bounded number of in-window `approved`/`completed`
 * lessons whose `calendar_sync_status` is `not_synced` or `sync_failed`.
 * Used by the manual Retry button and by every cron tick for a cheap
 * drain of transient failures. Returns `null` when the integration is
 * missing/needs_reconnect/disconnected (nothing ran) so the retry
 * endpoint can distinguish that from "ran but nothing to do."
 */
export async function runLightSyncPass(coachProfileId: string): Promise<LightPassResult | null> {
  let result: LightPassResult | null = null;
  await runSyncBatch(coachProfileId, async () => {
    const windowStart = startOfTodayLA();
    const rows = await db
      .select({ id: lessons.id })
      .from(lessons)
      .where(
        and(
          gte(lessons.startsAt, windowStart),
          inArray(lessons.status, ["approved", "completed"]),
          inArray(lessons.calendarSyncStatus, ["not_synced", "sync_failed"]),
        ),
      )
      .orderBy(asc(lessons.startsAt))
      .limit(LIGHT_PASS_CAP);
    let succeeded = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        await syncLessonToGoogle(row.id);
      } catch (err) {
        logger.error({ err, lessonId: row.id }, "light pass: per-lesson failure, continuing");
      }
      const [after] = await db
        .select({ status: lessons.calendarSyncStatus })
        .from(lessons)
        .where(eq(lessons.id, row.id))
        .limit(1);
      if (after?.status === "synced") succeeded++;
      else failed++;
      await sleep(100);
    }
    result = { attempted: rows.length, succeeded, failed };
  });
  return result;
}

/**
 * Full pass: reconcile every in-window `approved`/`completed` lesson,
 * regardless of `calendar_sync_status`, PLUS every in-window lesson that
 * still carries a `google_calendar_event_id` (so stray events on
 * canceled/declined/expired rows get removed). Used on connect/reconnect
 * and from the cron tick when `last_full_reconcile_at` is >24h old.
 *
 * On success, writes `last_full_reconcile_at = now()` to the integration
 * row so the cron can decide when to run the next full pass.
 */
export async function runFullSyncPass(coachProfileId: string): Promise<void> {
  let completed = false;
  await runSyncBatch(coachProfileId, async () => {
    const windowStart = startOfTodayLA();
    const rows = await db
      .select({ id: lessons.id })
      .from(lessons)
      .where(
        and(
          gte(lessons.startsAt, windowStart),
          or(
            inArray(lessons.status, ["approved", "completed"]),
            isNotNull(lessons.googleCalendarEventId),
          ),
        ),
      )
      .orderBy(asc(lessons.startsAt));
    for (const row of rows) {
      try {
        await syncLessonToGoogle(row.id);
      } catch (err) {
        logger.error({ err, lessonId: row.id }, "full pass: per-lesson failure, continuing");
      }
      await sleep(100);
    }
    completed = true;
  });
  if (completed) {
    await db
      .update(coachCalendarIntegrations)
      .set({ lastFullReconcileAt: new Date() })
      .where(eq(coachCalendarIntegrations.coachProfileId, coachProfileId));
  }
}

// Start of today in America/Los_Angeles, returned as a UTC Date. Looks up
// LA's current UTC offset (which is -07:00 during PDT and -08:00 during
// PST) from Intl rather than hardcoding either side — a hardcoded -08:00
// landed the window 1 hour too late every PDT day, silently excluding
// lessons starting 00:00–01:00 LA from the sync window.
//
// The `now` parameter is for tests; production callers pass nothing and
// get `new Date()`.
function startOfTodayLA(now: Date = new Date()): Date {
  const laDateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: LESSON_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = Number(laDateParts.find((part) => part.type === "year")!.value);
  const month = Number(laDateParts.find((part) => part.type === "month")!.value);
  const day = Number(laDateParts.find((part) => part.type === "day")!.value);

  // Probe LA's offset at a UTC instant guaranteed to fall on the same LA
  // calendar date and at least an hour from either DST transition. LA is
  // UTC-7 or UTC-8, so UTC 08:00 maps to LA 00:00 (PST) or LA 01:00 (PDT) —
  // same LA calendar day in both cases. DST begins at LA 02:00 PST (10:00
  // UTC) and ends at LA 02:00 PDT (09:00 UTC), both strictly after 08:00
  // UTC, so a probe at 08:00 reads the offset that applies at LA midnight.
  const probe = new Date(Date.UTC(year, month - 1, day, 8, 0, 0));
  const offsetName = new Intl.DateTimeFormat("en-US", {
    timeZone: LESSON_TIME_ZONE,
    timeZoneName: "longOffset",
  })
    .formatToParts(probe)
    .find((part) => part.type === "timeZoneName")!.value;
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(offsetName);
  if (!match) {
    throw new Error(`unexpected tz offset format for ${LESSON_TIME_ZONE}: ${offsetName}`);
  }
  const sign = match[1] === "+" ? 1 : -1;
  const offsetMs = sign * (Number(match[2]) * 60 + Number(match[3])) * 60 * 1000;

  // LA midnight expressed as UTC. For PST (offsetMs = -28800000) this is
  // the UTC midnight of the LA calendar date + 8h = 08:00 UTC. For PDT
  // (-25200000) it's + 7h = 07:00 UTC.
  const utcMidnightSameCalendarDate = Date.UTC(year, month - 1, day, 0, 0, 0);
  return new Date(utcMidnightSameCalendarDate - offsetMs);
}

/**
 * Wraps a sync batch (backfill or retry) with a server-side "run in
 * progress" marker on the integration row. The marker is set before the
 * batch starts and cleared in a finally block when it ends — even on
 * crash. The status endpoint also treats a marker older than 2 minutes
 * with no fresh progress as a stale run from a crashed API, so a server
 * restart mid-batch self-heals on the next status read.
 *
 * Returns silently if the coach has no active integration — this double-
 * checks the caller's own write committed.
 */
async function runSyncBatch(
  coachProfileId: string,
  work: () => Promise<void>,
): Promise<void> {
  const integrationRows = await db
    .select({ id: coachCalendarIntegrations.id })
    .from(coachCalendarIntegrations)
    .where(
      and(
        eq(coachCalendarIntegrations.coachProfileId, coachProfileId),
        eq(coachCalendarIntegrations.status, "active"),
      ),
    )
    .limit(1);
  if (integrationRows.length === 0) return;

  await db
    .update(coachCalendarIntegrations)
    .set({ syncRunStartedAt: new Date() })
    .where(eq(coachCalendarIntegrations.coachProfileId, coachProfileId));

  try {
    await work();
  } catch (err) {
    // The inner loop should have caught per-lesson errors — anything that
    // reaches here is from the surrounding setup, not from a per-lesson
    // sync. Log and continue to the finally so the run marker is cleared.
    logger.error({ err, coachProfileId }, "sync batch: unexpected failure");
  } finally {
    await db
      .update(coachCalendarIntegrations)
      .set({ syncRunStartedAt: null })
      .where(eq(coachCalendarIntegrations.coachProfileId, coachProfileId));
  }
}

/** Exported so the retry endpoint can share the exact run-marker behaviour. */
export { runSyncBatch };

interface ReconcileContext {
  lesson: typeof lessons.$inferSelect;
  firstNames: string[];
  location: typeof lessonLocations.$inferSelect;
  integration: typeof coachCalendarIntegrations.$inferSelect;
}

async function loadReconcileContext(lessonId: string): Promise<ReconcileContext | null> {
  const lessonRows = await db.select().from(lessons).where(eq(lessons.id, lessonId)).limit(1);
  const lesson = lessonRows[0];
  if (!lesson) return null;

  // Resolve the coach's profile id and scope the integration lookup to it,
  // plus `status='active'`. In a single-coach app the resolver just finds
  // the one coach profile. In a seeded dev DB with stale 'disconnected' or
  // 'needs_reconnect' rows under other profiles, this prevents picking up
  // the wrong one — the previous unscoped `.limit(1)` was a real bug.
  const coachProfileId = await getActiveCoachProfileId();
  if (!coachProfileId) return null;
  const integrationRows = await db
    .select()
    .from(coachCalendarIntegrations)
    .where(
      and(
        eq(coachCalendarIntegrations.coachProfileId, coachProfileId),
        eq(coachCalendarIntegrations.status, "active"),
      ),
    )
    .limit(1);
  const integration = integrationRows[0];
  if (!integration) return null;

  const locationRows = await db
    .select()
    .from(lessonLocations)
    .where(eq(lessonLocations.id, lesson.locationId))
    .limit(1);
  const location = locationRows[0];
  if (!location) return null;

  const swimmerRows = await db
    .select({ firstName: swimmers.firstName })
    .from(lessonSwimmers)
    .innerJoin(swimmers, eq(lessonSwimmers.swimmerId, swimmers.id))
    .where(eq(lessonSwimmers.lessonId, lessonId))
    .orderBy(asc(swimmers.firstName));
  const firstNames = swimmerRows.map((row) => row.firstName);

  return { lesson, firstNames, location, integration };
}

function toGoogleEventId(lessonUuid: string): string {
  // Google event ids accept lowercase base32hex (a-v, 0-9) and 5-1024 chars.
  // A UUID's 32 hex chars with dashes stripped are a valid subset.
  return lessonUuid.replace(/-/g, "").toLowerCase();
}

function buildSummary(firstNames: string[]): string {
  if (firstNames.length === 0) return "Swim lesson";
  if (firstNames.length === 1) return `Swim lesson: ${firstNames[0]}`;
  const last = firstNames[firstNames.length - 1];
  const rest = firstNames.slice(0, -1).join(", ");
  return `Swim lesson: ${rest} & ${last}`;
}

function formatLocation(location: typeof lessonLocations.$inferSelect): string {
  // Home pools (non-null householdId on lesson_locations) are a specific
  // family's private residential address. We do not push residential
  // addresses to a third-party (Google) under an event's `location` field —
  // the risk is a privacy question for parents, and this exact rule is
  // pending Jason and the kids'-data legal review. See ADR 027 and
  // docs/accounts.md. Named pools (null householdId) are public venues and
  // keep the full address so Google Maps gives the coach the "View map"
  // link they expect.
  if (location.householdId !== null) {
    return `${location.name} — ${location.city}, ${location.state}`;
  }
  return `${location.name} — ${location.address}, ${location.city}, ${location.state} ${location.zip}`;
}

async function markLessonSynced(
  lessonId: string,
  coachProfileId: string,
  patch: { googleCalendarEventId: string | null },
): Promise<void> {
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(lessons)
      .set({
        calendarSyncStatus: "synced",
        calendarSyncError: null,
        googleCalendarEventId: patch.googleCalendarEventId,
        calendarSyncAttempts: sql`${lessons.calendarSyncAttempts} + 1`,
      })
      .where(eq(lessons.id, lessonId));
    await tx
      .update(coachCalendarIntegrations)
      .set({ lastSyncAttemptedAt: now, lastSyncSucceededAt: now })
      .where(eq(coachCalendarIntegrations.coachProfileId, coachProfileId));
  });
}

async function markLessonSyncFailed(
  lessonId: string,
  coachProfileId: string,
  reasonTag: string,
  err: unknown,
): Promise<void> {
  const safe = googleClient.toSafeGoogleError(err);
  const message = `${reasonTag}: ${safe.message}`.slice(0, 500);
  logger.warn({ googleError: safe, lessonId, reasonTag }, "google sync failed");
  await db.transaction(async (tx) => {
    await tx
      .update(lessons)
      .set({
        calendarSyncStatus: "sync_failed",
        calendarSyncError: message,
        calendarSyncAttempts: sql`${lessons.calendarSyncAttempts} + 1`,
      })
      .where(eq(lessons.id, lessonId));
    await tx
      .update(coachCalendarIntegrations)
      .set({ lastSyncAttemptedAt: new Date() })
      .where(eq(coachCalendarIntegrations.coachProfileId, coachProfileId));
  });
}

async function markNeedsReconnect(lessonId: string, coachProfileId: string): Promise<void> {
  // One transaction: flip the integration to needs_reconnect and record the
  // lesson failure so the lesson UI reflects reality.
  await db.transaction(async (tx) => {
    const now = new Date();
    await tx
      .update(coachCalendarIntegrations)
      .set({ status: "needs_reconnect", needsReconnectSince: now, lastSyncAttemptedAt: now })
      .where(eq(coachCalendarIntegrations.coachProfileId, coachProfileId));
    await tx
      .update(lessons)
      .set({
        calendarSyncStatus: "sync_failed",
        calendarSyncError: "token_revoked",
        calendarSyncAttempts: sql`${lessons.calendarSyncAttempts} + 1`,
      })
      .where(eq(lessons.id, lessonId));
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * HTTP 403 and 429 from Google are retryable: 403 covers `rateLimitExceeded`
 * and `userRateLimitExceeded` (Calendar API uses 403 for quota, not just
 * permission errors), and 429 is the explicit "too many requests." Both
 * should mark the lesson sync_failed so the next light pass retries it,
 * never flip the integration to needs_reconnect.
 */
function isRetryableGoogleHttpError(err: unknown): boolean {
  const safe = googleClient.toSafeGoogleError(err);
  return safe.status === 403 || safe.status === 429;
}

/** Exposed for tests. */
export const __test = {
  toGoogleEventId,
  buildSummary,
  formatLocation,
  startOfTodayLA,
};
