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

    const status: GoogleCalendarStatus = row.status === "needs_reconnect" ? "needs_reconnect" : "active";
    const body: GoogleCalendarStatusResponse = {
      status,
      connectedAccountEmail: row.googleAccountEmail,
      connectedAt: row.connectedAt.toISOString(),
      googleCalendarId: row.googleCalendarId,
      lastSyncAttemptedAt: row.lastSyncAttemptedAt?.toISOString() ?? null,
      lastSyncSucceededAt: row.lastSyncSucceededAt?.toISOString() ?? null,
      needsReconnectSince: row.needsReconnectSince?.toISOString() ?? null,
    };
    res.json(body);
  }),
);

// ── DELETE /coach/calendar ───────────────────────────────────────────────────
// Revoke the refresh token at Google, then delete the integration row and
// write a disconnect audit entry in one transaction. The dedicated Google
// calendar is left intact — the coach can delete it manually. Phase 1 does
// not yet clear lesson sync columns because no lessons have been synced yet.

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
    if (!row) {
      res.status(404).json({ error: "No Google Calendar integration to disconnect" });
      return;
    }

    // Decrypt the refresh token to revoke it. If decrypt fails (e.g. the key
    // was rotated incorrectly) we still delete the local row — leaving a
    // dead integration in place is worse than skipping the revoke.
    let refreshToken: string | undefined;
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

    // Revoke outside the transaction. A failure here is logged but does not
    // block the local delete — the coach's intent is clear and the token
    // will eventually expire on Google's side anyway.
    if (refreshToken) {
      try {
        await googleClient.revokeToken(env.googleOAuth, refreshToken);
      } catch (err) {
        req.log.warn({ err }, "disconnect: Google revoke failed, continuing with local delete");
      }
    }

    await db.transaction(async (tx) => {
      await tx.insert(coachAuditLog).values({
        coachId: req.profile.id,
        actorId: req.profile.id,
        action: "calendar_disconnected",
      });
      await tx
        .delete(coachCalendarIntegrations)
        .where(eq(coachCalendarIntegrations.coachProfileId, req.profile.id));
    });

    res.status(204).end();
  }),
);
