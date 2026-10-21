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
import { syncLessonToGoogle } from "../services/googleCalendarSync";

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
    const body: GoogleCalendarStatusResponse = {
      status,
      connectedAccountEmail: status === "not_connected" ? null : row.googleAccountEmail,
      connectedAt: status === "not_connected" ? null : row.connectedAt.toISOString(),
      googleCalendarId: status === "not_connected" ? null : row.googleCalendarId,
      lastSyncAttemptedAt: row.lastSyncAttemptedAt?.toISOString() ?? null,
      lastSyncSucceededAt: row.lastSyncSucceededAt?.toISOString() ?? null,
      needsReconnectSince: row.needsReconnectSince?.toISOString() ?? null,
      ...counts,
    };
    res.json(body);
  }),
);

// ── POST /coach/calendar/retry-failed ────────────────────────────────────────
// Reconciles every lesson currently in calendar_sync_status='sync_failed'.
// Sequential, 100ms gap between calls. Returns 409 if the integration needs
// reconnect — retry would just spin up more invalid_grants.

coachCalendarRouter.post(
  "/calendar/retry-failed",
  validate({}),
  asyncHandler(async (req, res) => {
    const env = getEnv();
    if (!env.googleOAuth) {
      res.status(503).json({ error: "Google Calendar integration not configured" });
      return;
    }
    const integrationRows = await db
      .select()
      .from(coachCalendarIntegrations)
      .where(eq(coachCalendarIntegrations.coachProfileId, req.profile.id))
      .limit(1);
    const integration = integrationRows[0];
    if (!integration || integration.status !== "active") {
      res.status(409).json({ error: "Reconnection required" });
      return;
    }

    const failedRows = await db
      .select({ id: lessons.id })
      .from(lessons)
      .where(eq(lessons.calendarSyncStatus, "sync_failed"));

    // Insert the audit row up-front so the retry attempt is recorded even
    // if the loop crashes (CLAUDE.md: audit writes share a transaction with
    // the change — the per-lesson reconcile writes its own lesson-row
    // transactions, so a single retry audit for the whole batch is wrapped
    // alongside the first state the retry endpoint can meaningfully claim).
    await db.transaction(async (tx) => {
      await tx.insert(coachAuditLog).values({
        coachId: req.profile.id,
        actorId: req.profile.id,
        action: "calendar_sync_retried",
      });
    });

    let succeeded = 0;
    let failed = 0;
    for (const row of failedRows) {
      await syncLessonToGoogle(row.id);
      // Read back the lesson's new status to count outcomes.
      const after = await db
        .select({ status: lessons.calendarSyncStatus })
        .from(lessons)
        .where(eq(lessons.id, row.id))
        .limit(1);
      if (after[0]?.status === "synced") succeeded++;
      else failed++;
      await sleep(100); // 100ms between Google calls (stay under 500/100s quota)
    }

    const body: RetryAllFailedResponse = {
      attempted: failedRows.length,
      succeeded,
      failed,
    };
    res.json(body);
  }),
);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
        req.log.warn({ err }, "disconnect: could not decrypt refresh token, skipping Google revoke");
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
          needsReconnectSince: null,
        })
        .where(eq(coachCalendarIntegrations.coachProfileId, req.profile.id));
    });

    res.status(204).end();
  }),
);
