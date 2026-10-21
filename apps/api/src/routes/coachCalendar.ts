import { Router } from "express";
import { eq } from "drizzle-orm";
import {
  type GoogleCalendarStatus,
  type GoogleCalendarStatusResponse,
} from "@swim-app/shared";
import { db } from "../db/client";
import { coachAuditLog, coachCalendarIntegrations } from "../db/schema";
import { getEnv } from "../lib/env";
import { decryptToken } from "../lib/tokenEncryption";
import { asyncHandler } from "../middleware/asyncHandler";
import { validate } from "../middleware/validate";
import * as googleClient from "../services/googleCalendarClient";

export const coachCalendarRouter = Router();

// ── GET /coach/calendar/status ───────────────────────────────────────────────

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
    const body: GoogleCalendarStatusResponse = {
      status,
      connectedAccountEmail: status === "not_connected" ? null : row.googleAccountEmail,
      connectedAt: status === "not_connected" ? null : row.connectedAt.toISOString(),
      googleCalendarId: status === "not_connected" ? null : row.googleCalendarId,
      lastSyncAttemptedAt: row.lastSyncAttemptedAt?.toISOString() ?? null,
      lastSyncSucceededAt: row.lastSyncSucceededAt?.toISOString() ?? null,
      needsReconnectSince: row.needsReconnectSince?.toISOString() ?? null,
    };
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
