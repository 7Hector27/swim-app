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
import { backfillCoachLessons } from "../services/googleCalendarSync";

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
    const query = req.query as GoogleOAuthCallbackQuery;
    const returnTo = "/account";
    // Resolve a site URL even when the integration isn't configured so we
    // can still redirect the browser somewhere human-friendly.
    const siteUrl = env.siteUrl;
    const errorRedirect = (): void => {
      res.redirect(buildReturnUrl(siteUrl, returnTo, { google: "error" }));
    };

    if (!env.googleOAuth) {
      req.log.warn("google callback: integration not configured");
      errorRedirect();
      return;
    }

    // Verify state first — before even looking at `code` or `error`. A valid
    // state proves this redirect came from a flow we started.
    let coachId: string;
    try {
      const payload = verifyState(query.state, env.googleOAuth.stateSecret);
      coachId = payload.coachId;
    } catch (err) {
      if (err instanceof InvalidStateError) {
        req.log.warn({ reason: err.reason }, "google callback: invalid state");
      } else {
        req.log.error({ err }, "google callback: unexpected error verifying state");
      }
      errorRedirect();
      return;
    }

    // The user denied consent on Google's screen, or Google itself errored.
    // Both paths funnel through the same friendly "error" state on the card
    // so the UI copy stays simple.
    if (query.error) {
      req.log.info({ error: query.error }, "google callback: user denied or Google error");
      errorRedirect();
      return;
    }

    if (!query.code) {
      req.log.warn("google callback: missing authorization code");
      errorRedirect();
      return;
    }

    // Exchange the code outside the DB transaction — it's an HTTP round-trip
    // we don't want to hold a lock on. Any failure here is logged and the
    // coach is sent back to the card with the "Couldn't connect" message.
    let tokens: Awaited<ReturnType<typeof googleClient.exchangeCodeForTokens>>;
    try {
      tokens = await googleClient.exchangeCodeForTokens(env.googleOAuth, query.code);
    } catch (err) {
      req.log.error(
        { googleError: googleClient.toSafeGoogleError(err), coachId },
        "google callback: token exchange failed",
      );
      errorRedirect();
      return;
    }

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
    try {
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
    } catch (err) {
      req.log.error(
        { googleError: googleClient.toSafeGoogleError(err), coachId },
        "google callback: calendar provisioning failed",
      );
      errorRedirect();
      return;
    }

    const encrypted = encryptToken(tokens.refreshToken, env.googleOAuth.tokenEncryptionKey);

    try {
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
    } catch (err) {
      req.log.error({ err, coachId }, "google callback: database write failed");
      errorRedirect();
      return;
    }

    res.redirect(buildReturnUrl(siteUrl, returnTo, { google: "connected" }));

    // Backfill in the background after the browser is already on its way to
    // /account. The card polls the status endpoint and reports progress via
    // the sync counts (see phase 2.3). Rejections swallowed by the microtask
    // queue — the service catches its own errors.
    queueMicrotask(() => {
      void backfillCoachLessons(coachId);
    });
  }),
);

function buildReturnUrl(siteUrl: string, path: string, params: Record<string, string>): string {
  const url = new URL(path, siteUrl);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}
