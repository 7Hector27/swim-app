import { Router } from "express";
import { and, count, eq, gt } from "drizzle-orm";
import {
  type GoogleCalendarStatus,
  type GoogleCalendarStatusResponse,
  type RetryAllFailedResponse,
} from "@swim-app/shared";
import { db } from "../db/client";
import { coachAuditLog, coachCalendarIntegrations, lessons } from "../db/schema";
import { getEnv } from "../lib/env";
import { decryptToken } from "../lib/tokenEncryption";
import { asyncHandler } from "../middleware/asyncHandler";
import { validate } from "../middleware/validate";
import * as googleClient from "../services/googleCalendarClient";
import { runLightSyncPass } from "../services/googleCalendarSync";

export const coachCalendarRouter = Router();

// ── GET /coach/calendar/status ───────────────────────────────────────────────

const ZERO_COUNTS = {
  upcomingLessonCount: 0,
  syncedCount: 0,
  pendingSyncCount: 0,
  failedLessonCount: 0,
};

async function computeSyncCounts(): Promise<typeof ZERO_COUNTS> {
  // Counts over upcoming approved lessons. The single-coach app has no
  // coach_id column on lessons; a future multi-coach model would scope
  // these counts to the integration's coach_profile_id.
  const upcomingApproved = and(eq(lessons.status, "approved"), gt(lessons.startsAt, new Date()));
  const rows = await db
    .select({
      status: lessons.calendarSyncStatus,
      total: count(),
    })
    .from(lessons)
    .where(upcomingApproved)
    .groupBy(lessons.calendarSyncStatus);

  const result = { ...ZERO_COUNTS };
  for (const row of rows) {
    result.upcomingLessonCount += Number(row.total);
    if (row.status === "synced") result.syncedCount = Number(row.total);
    else if (row.status === "not_synced") result.pendingSyncCount = Number(row.total);
    else if (row.status === "sync_failed") result.failedLessonCount = Number(row.total);
  }
  return result;
}

// A sync batch is "in progress" when its started_at is set AND recent.
// 2-minute inactivity window: if the batch wrote the started_at but no
// per-lesson progress has landed for 2 minutes, assume the API crashed
// (or `finally` didn't run) and let the UI stop polling. Fresh progress
// (lastSyncAttemptedAt) extends the window — a slow backfill shouldn't
// time out mid-run.
//
// Hard cutoff: regardless of lastSyncAttemptedAt, a run whose
// sync_run_started_at is older than 10 minutes is considered stale.
// This caps the inactivity-window extension so a buggy loop that
// stamps progress forever can't pin the UI's syncing banner. 10m is
// well above the biggest realistic batch (FULL_PASS_CAP=500 × 100ms
// sleep ≈ 50s even assuming all failures surface instantly).
const SYNC_RUN_INACTIVITY_MS = 2 * 60 * 1000;
const SYNC_RUN_HARD_CUTOFF_MS = 10 * 60 * 1000;

function isSyncRunInProgress(
  startedAt: Date | null,
  lastProgressAt: Date | null,
  nowMs: number = Date.now(),
): boolean {
  if (!startedAt) return false;
  if (nowMs - startedAt.getTime() > SYNC_RUN_HARD_CUTOFF_MS) return false;
  const mostRecent = Math.max(
    startedAt.getTime(),
    lastProgressAt?.getTime() ?? 0,
  );
  return nowMs - mostRecent <= SYNC_RUN_INACTIVITY_MS;
}

coachCalendarRouter.get(
  "/calendar/status",
  validate({}),
  asyncHandler(async (req, res) => {
    const env = getEnv();
    if (!env.googleOAuth) {
      const body: GoogleCalendarStatusResponse = {
        status: "not_configured",
        connectedAccountEmail: null,
        connectedAt: null,
        googleCalendarId: null,
        lastSyncAttemptedAt: null,
        lastSyncSucceededAt: null,
        needsReconnectSince: null,
        ...ZERO_COUNTS,
        syncRunInProgress: false,
      };
      res.json(body);
      return;
    }

    const rows = await db
      .select()
      .from(coachCalendarIntegrations)
      .where(eq(coachCalendarIntegrations.coachProfileId, req.profile.id))
      .limit(1);
    const row = rows[0];

    if (!row) {
      const body: GoogleCalendarStatusResponse = {
        status: "not_connected",
        connectedAccountEmail: null,
        connectedAt: null,
        googleCalendarId: null,
        lastSyncAttemptedAt: null,
        lastSyncSucceededAt: null,
        needsReconnectSince: null,
        ...ZERO_COUNTS,
        syncRunInProgress: false,
      };
      res.json(body);
      return;
    }

    // 'disconnected' rows look the same to the UI as "not connected" — the
    // Connect button is shown. The row itself persists only so reconnect can
    // reuse the dedicated calendar id without creating a fresh calendar in
    // the coach's Google account. See ADR 027.
    const status: GoogleCalendarStatus =
      row.status === "needs_reconnect"
        ? "needs_reconnect"
        : row.status === "disconnected"
          ? "not_connected"
          : "active";
    const counts = status === "not_connected" ? ZERO_COUNTS : await computeSyncCounts();
    const syncRunInProgress =
      status === "active" && isSyncRunInProgress(row.syncRunStartedAt, row.lastSyncAttemptedAt);
    const body: GoogleCalendarStatusResponse = {
      status,
      connectedAccountEmail: status === "not_connected" ? null : row.googleAccountEmail,
      connectedAt: status === "not_connected" ? null : row.connectedAt.toISOString(),
      googleCalendarId: status === "not_connected" ? null : row.googleCalendarId,
      lastSyncAttemptedAt: row.lastSyncAttemptedAt?.toISOString() ?? null,
      lastSyncSucceededAt: row.lastSyncSucceededAt?.toISOString() ?? null,
      needsReconnectSince: row.needsReconnectSince?.toISOString() ?? null,
      ...counts,
      syncRunInProgress,
    };
    res.json(body);
  }),
);

// ── POST /coach/calendar/retry-failed ────────────────────────────────────────
// Runs a light sync pass: reconciles up to 50 in-window approved/completed
// lessons whose calendar_sync_status is not_synced or sync_failed. The pass
// goes through runSyncBatch, so it short-circuits (returns null) when the
// integration is needs_reconnect or disconnected — surfaced here as a 409.

coachCalendarRouter.post(
  "/calendar/retry-failed",
  validate({}),
  asyncHandler(async (req, res) => {
    const env = getEnv();
    if (!env.googleOAuth) {
      res.status(503).json({ error: "Google Calendar integration not configured" });
      return;
    }

    const result = await runLightSyncPass(req.profile.id);
    if (result === null) {
      // runLightSyncPass short-circuited: no active integration.
      res.status(409).json({ error: "Reconnection required" });
      return;
    }

    // Audit AFTER the loop with the final counts, not before with no counts.
    // CLAUDE.md's "audit in same tx as the change" rule can't apply here —
    // this audit records the outcome of many independent per-lesson
    // transactions interleaved with HTTP calls to Google that we cannot hold
    // open under a lock. ADR 027 documents the deviation. If the server
    // crashes mid-loop, the lesson rows themselves record what did and
    // didn't flip to 'synced', so the audit row's absence is recoverable.
    await db.insert(coachAuditLog).values({
      coachId: req.profile.id,
      actorId: req.profile.id,
      action: "calendar_sync_retried",
      payload: result,
    });

    const body: RetryAllFailedResponse = result;
    res.json(body);
  }),
);

// ── DELETE /coach/calendar ───────────────────────────────────────────────────
// Revoke the refresh token at Google, then flip the integration row's status
// to 'disconnected' and clear the token fields in one transaction. The row
// (and especially its google_calendar_id) is preserved so the next connect
// can reuse the dedicated calendar instead of leaving a fresh orphan in the
// coach's Google account. The dedicated Google calendar itself is left
// intact. Phase 1 doesn't clear lesson sync columns yet (no lessons have
// been synced).

coachCalendarRouter.delete(
  "/calendar",
  validate({}),
  asyncHandler(async (req, res) => {
    const env = getEnv();
    if (!env.googleOAuth) {
      res.status(503).json({ error: "Google Calendar integration not configured" });
      return;
    }

    const rows = await db
      .select()
      .from(coachCalendarIntegrations)
      .where(eq(coachCalendarIntegrations.coachProfileId, req.profile.id))
      .limit(1);
    const row = rows[0];
    if (!row || row.status === "disconnected") {
      // Already disconnected (or never connected) → nothing to do.
      res.status(404).json({ error: "No Google Calendar integration to disconnect" });
      return;
    }

    // Decrypt the refresh token to revoke it. If decrypt fails (e.g. the key
    // was rotated incorrectly) we still mark the row disconnected — leaving
    // a dead integration in place is worse than skipping the revoke.
    let refreshToken: string | undefined;
    if (
      row.refreshTokenCiphertext &&
      row.refreshTokenIv &&
      row.refreshTokenTag &&
      row.refreshTokenKeyVersion !== null
    ) {
      try {
        refreshToken = decryptToken(
          {
            ciphertext: row.refreshTokenCiphertext,
            iv: row.refreshTokenIv,
            tag: row.refreshTokenTag,
            keyVersion: row.refreshTokenKeyVersion,
          },
          env.googleOAuth.tokenEncryptionKey,
        );
      } catch (err) {
        // Log a shaped reason + the error's message string only, never
        // the raw error object. Standard Node crypto errors
        // ("Unsupported state or unable to authenticate data") don't
        // carry key material, but a future Node version or library
        // change could attach properties we don't want in logs. Mirrors
        // the pattern used for Google API errors (see toSafeGoogleError).
        req.log.warn(
          { reason: "decrypt_failed", errorMessage: err instanceof Error ? err.message : String(err) },
          "disconnect: could not decrypt refresh token, skipping Google revoke",
        );
      }
    }

    // Revoke outside the transaction. A failure here is logged but does not
    // block the local update — the coach's intent is clear and the token
    // will eventually expire on Google's side anyway.
    if (refreshToken) {
      try {
        await googleClient.revokeToken(env.googleOAuth, refreshToken);
      } catch (err) {
        req.log.warn(
          { googleError: googleClient.toSafeGoogleError(err) },
          "disconnect: Google revoke failed, continuing with local update",
        );
      }
    }

    await db.transaction(async (tx) => {
      await tx.insert(coachAuditLog).values({
        coachId: req.profile.id,
        actorId: req.profile.id,
        action: "calendar_disconnected",
      });
      await tx
        .update(coachCalendarIntegrations)
        .set({
          status: "disconnected",
          refreshTokenCiphertext: null,
          refreshTokenIv: null,
          refreshTokenTag: null,
          refreshTokenKeyVersion: null,
          scope: null,
          // Clear the coach's Google account email too. We only need it to
          // show "Connected as <email>" (active) or "Reconnect <email>"
          // (needs_reconnect). After an explicit disconnect, retaining
          // the personal address serves no purpose and the next connect
          // will refresh it from Google's id_token.
          googleAccountEmail: null,
          needsReconnectSince: null,
        })
        .where(eq(coachCalendarIntegrations.coachProfileId, req.profile.id));
    });

    res.status(204).end();
  }),
);
