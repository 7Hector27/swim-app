import { Router } from "express";
import { eq } from "drizzle-orm";
import {
  GoogleOAuthCallbackQuerySchema,
  GoogleOAuthStartQuerySchema,
  type GoogleOAuthCallbackQuery,
} from "@swim-app/shared";
import { db } from "../db/client";
import { coachAuditLog, coachCalendarIntegrations } from "../db/schema";
import { getEnv } from "../lib/env";
import { encryptToken } from "../lib/tokenEncryption";
import { InvalidStateError, signState, verifyState } from "../lib/oauthState";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireCoach } from "../middleware/requireCoach";
import { requireUser } from "../middleware/requireUser";
import { validate } from "../middleware/validate";
import * as googleClient from "../services/googleCalendarClient";

export const integrationsGoogleRouter = Router();

// ── GET /integrations/google/start ───────────────────────────────────────────
// Returns the Google authorize URL as JSON. The caller (a web app server
// action) issues the browser redirect itself — the API can't do a 302
// directly because it's reached by fetch, not by a top-level navigation.
//
// `returnTo` is accepted for forward-compat but not yet threaded through
// the callback; v1 always sends the browser back to /account.

integrationsGoogleRouter.get(
  "/google/start",
  requireUser,
  requireCoach,
  validate({ query: GoogleOAuthStartQuerySchema }),
  (req, res) => {
    const env = getEnv();
    if (!env.googleOAuth) {
      res.status(503).json({ error: "Google Calendar integration not configured" });
      return;
    }
    const state = signState(req.profile.id, env.googleOAuth.stateSecret);
    const authorizeUrl = googleClient.getAuthorizeUrl(env.googleOAuth, state);
    res.json({ authorizeUrl });
  },
);

// ── GET /integrations/google/callback ────────────────────────────────────────
// Public (no requireUser). Google redirects the browser here with ?code&state.
// The state parameter is HMAC-signed and binds the request to a specific
// coach, so there's no CSRF risk even though the handler is unauthenticated.

integrationsGoogleRouter.get(
  "/google/callback",
  validate({ query: GoogleOAuthCallbackQuerySchema }),
  asyncHandler(async (req, res) => {
    const env = getEnv();
    if (!env.googleOAuth) {
      res.status(503).send("Google Calendar integration not configured");
      return;
    }
    const query = req.query as GoogleOAuthCallbackQuery;
    const returnTo = "/account";

    // Verify state first — before even looking at `code` or `error`. A valid
    // state proves this redirect came from a flow we started.
    let coachId: string;
    try {
      const payload = verifyState(query.state, env.googleOAuth.stateSecret);
      coachId = payload.coachId;
    } catch (err) {
      if (err instanceof InvalidStateError) {
        req.log.warn({ reason: err.reason }, "google callback: invalid state");
        res.status(400).send("Invalid or expired OAuth state. Please try connecting again.");
        return;
      }
      throw err;
    }

    // The user denied consent on Google's screen, or Google itself errored.
    if (query.error) {
      req.log.info({ error: query.error }, "google callback: user denied or Google error");
      res.redirect(buildReturnUrl(env.siteUrl, returnTo, { google: "cancelled" }));
      return;
    }

    if (!query.code) {
      res.status(400).send("Missing authorization code.");
      return;
    }

    // Exchange the code outside the DB transaction — it's an HTTP round-trip
    // we don't want to hold a lock on.
    const tokens = await googleClient.exchangeCodeForTokens(env.googleOAuth, query.code);

    // Reconnect path: if we already have an integration row and its calendar
    // still exists in Google, reuse the calendar id. Only create a new one
    // when the previous calendar was deleted out-of-band.
    const existing = await db
      .select()
      .from(coachCalendarIntegrations)
      .where(eq(coachCalendarIntegrations.coachProfileId, coachId))
      .limit(1);
    const prior = existing[0];
    const isReconnect = Boolean(prior);

    let googleCalendarId: string;
    if (prior) {
      const { exists } = await googleClient.calendarExists(
        env.googleOAuth,
        tokens.accessToken,
        prior.googleCalendarId,
      );
      if (exists) {
        googleCalendarId = prior.googleCalendarId;
      } else {
        const created = await googleClient.createDedicatedCalendar(env.googleOAuth, tokens.accessToken);
        googleCalendarId = created.id;
      }
    } else {
      const created = await googleClient.createDedicatedCalendar(env.googleOAuth, tokens.accessToken);
      googleCalendarId = created.id;
    }

    const encrypted = encryptToken(tokens.refreshToken, env.googleOAuth.tokenEncryptionKey);

    await db.transaction(async (tx) => {
      if (prior) {
        await tx
          .update(coachCalendarIntegrations)
          .set({
            status: "active",
            googleCalendarId,
            googleAccountEmail: tokens.email,
            scope: tokens.scope,
            refreshTokenCiphertext: encrypted.ciphertext,
            refreshTokenIv: encrypted.iv,
            refreshTokenTag: encrypted.tag,
            refreshTokenKeyVersion: encrypted.keyVersion,
            needsReconnectSince: null,
          })
          .where(eq(coachCalendarIntegrations.coachProfileId, coachId));
      } else {
        await tx.insert(coachCalendarIntegrations).values({
          coachProfileId: coachId,
          status: "active",
          googleCalendarId,
          googleAccountEmail: tokens.email,
          scope: tokens.scope,
          refreshTokenCiphertext: encrypted.ciphertext,
          refreshTokenIv: encrypted.iv,
          refreshTokenTag: encrypted.tag,
          refreshTokenKeyVersion: encrypted.keyVersion,
        });
      }
      await tx.insert(coachAuditLog).values({
        coachId,
        actorId: coachId,
        action: isReconnect ? "calendar_reconnected" : "calendar_connected",
      });
    });

    res.redirect(buildReturnUrl(env.siteUrl, returnTo, { google: "connected" }));
  }),
);

function buildReturnUrl(siteUrl: string, path: string, params: Record<string, string>): string {
  const url = new URL(path, siteUrl);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}
