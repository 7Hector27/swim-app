// One-way sync from the app's lessons table to the coach's Google Calendar.
// See docs/decisions/027-google-calendar-sync.md and
// docs/plans/google-calendar-sync.md for the full design.
//
// Every lesson route (approve, decline, reschedule, cancel on both coach
// and parent paths), the backfill loop, and the manual retry endpoint call
// the single reconcile function exported here.

import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";

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

/**
 * Read the lesson's current state and make Google match it. Idempotent;
 * safe to call from any number of paths or in rapid succession. Errors are
 * caught and translated to row updates — the caller never needs a try/catch.
 */
export async function syncLessonToGoogle(lessonId: string): Promise<void> {
  const env = getEnv();
  if (!env.googleOAuth) return;

  // loadReconcileContext scopes the integration query to status='active',
  // so a non-null context means the integration is currently serving writes.
  // This short-circuit keeps `invalid_grant` storms (after an out-of-band
  // revoke) from piling up on every lesson row the coach touches.
  const context = await loadReconcileContext(lessonId);
  if (!context) return;
  const { lesson, firstNames, location, integration } = context;

  const eventId = toGoogleEventId(lesson.id);
  const shouldExist =
    lesson.status === "approved" && lesson.startsAt.getTime() > Date.now();

  // Nothing to do when the lesson has never been pushed and no event is
  // expected (pending/declined/canceled/etc. that was never approved).
  if (!shouldExist && !lesson.googleCalendarEventId) {
    return;
  }

  let accessToken: string;
  try {
    const refreshToken = decryptToken(
      {
        ciphertext: integration.refreshTokenCiphertext!,
        iv: integration.refreshTokenIv!,
        tag: integration.refreshTokenTag!,
        keyVersion: integration.refreshTokenKeyVersion ?? 1,
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
      await markLessonSynced(lesson.id, integration.coachProfileId, { googleCalendarEventId: eventId });
    } else {
      await googleClient.deleteEventIdempotent(
        env.googleOAuth,
        accessToken,
        integration.googleCalendarId,
        eventId,
      );
      await markLessonSynced(lesson.id, integration.coachProfileId, { googleCalendarEventId: null });
    }
  } catch (err) {
    await markLessonSyncFailed(lesson.id, integration.coachProfileId, "google_api_error", err);
  }
}

/**
 * Backfill / resync loop. Reconciles every upcoming approved lesson whose
 * `calendar_sync_status` is `not_synced` or `sync_failed` for the given
 * coach, with a 100ms gap between calls to stay under Google quotas. Safe
 * to call concurrently with lesson-event microtasks because each call to
 * syncLessonToGoogle is idempotent on the shared event id.
 */
export async function backfillCoachLessons(coachProfileId: string): Promise<void> {
  try {
    // Verify the caller's coach actually owns an active integration before
    // iterating lessons. In a single-coach app this double-checks the
    // callback's own write committed; in a multi-coach future, this is
    // the scoping that pairs the lessons we iterate with the coach we're
    // writing to Google for.
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

    const rows = await db
      .select({ id: lessons.id })
      .from(lessons)
      .where(
        and(
          eq(lessons.status, "approved"),
          gt(lessons.startsAt, new Date()),
          inArray(lessons.calendarSyncStatus, ["not_synced", "sync_failed"]),
        ),
      )
      .orderBy(asc(lessons.startsAt));
    for (const row of rows) {
      await syncLessonToGoogle(row.id);
      await sleep(100);
    }
  } catch (err) {
    logger.error({ err, coachProfileId }, "backfill: unexpected failure");
  }
}

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

/** Exposed for tests. */
export const __test = {
  toGoogleEventId,
  buildSummary,
  formatLocation,
};
