import { calendar as calendarApi, auth as googleAuth } from "@googleapis/calendar";
import type { GoogleOAuthEnv } from "../lib/env";
import { withTimeout } from "../lib/outboundTimeout";

// Thin wrapper over google-auth-library + @googleapis/calendar. Routes and
// services call these functions; tests mock this module.
//
// Only the surface area needed for phase 1 is exposed: authorize URL,
// token exchange, calendar existence check, calendar creation, and token
// revocation. Lesson-event CRUD lands in a later phase.

// Scope kept narrow per ADR 027: we can only touch calendars this OAuth
// client created, never the coach's primary or other calendars.
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.app.created";

// Two non-sensitive scopes we also request so Google returns an id_token
// with the signed-in account's email. Used only to display "Connected as
// <email>" on the status card. Neither widens calendar or data access.
// Both are OpenID Connect scopes — no Google-sensitive scope review needed.
export const OPENID_SCOPE = "openid";
export const EMAIL_SCOPE = "email";

// Timezone passed when creating the dedicated calendar. Hardcoded for now;
// see docs/plans/google-calendar-sync.md "Resolved decisions" > Timezone.
// TODO: per-coach timezone if we ever expand beyond LA.
const CALENDAR_TIME_ZONE = "America/Los_Angeles";
const CALENDAR_SUMMARY = "Axiom Aquatics Lessons";
const CALENDAR_DESCRIPTION = "Lessons scheduled through the Axiom Aquatics app. Do not edit here — changes won't flow back to the app.";

export interface ExchangedTokens {
  refreshToken: string;
  accessToken: string;
  // Email from the ID token; used only for display on the status card.
  // Null when Google omitted an id_token or the id_token lacked an email
  // claim (e.g. a workspace account with the email scope stripped). Missing
  // email is non-fatal — the status card shows "Connected" without an
  // address instead of 500-ing the entire callback.
  email: string | null;
  // Space-delimited scope string Google returned, so the API can detect
  // scope drift (e.g. coach manually added a broader scope later).
  scope: string;
}

/**
 * Build the Google authorize URL for the OAuth consent screen.
 * `access_type=offline` + `prompt=consent` guarantees we get a refresh token
 * on every connect, including reconnects after the coach revoked us.
 */
export function getAuthorizeUrl(env: GoogleOAuthEnv, state: string): string {
  const client = buildOAuth2Client(env);
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    // openid + email are non-sensitive OpenID Connect scopes we add so Google
    // returns an id_token whose `email` claim we display on the status card.
    // Neither widens access to calendars or other data. calendar.app.created
    // stays the single sensitive scope.
    scope: [OPENID_SCOPE, EMAIL_SCOPE, CALENDAR_SCOPE],
    include_granted_scopes: true,
    state,
  });
}

/**
 * Exchange an authorization code for tokens and pull the account email out
 * of the ID token. Throws if Google returns an error or omits a refresh or
 * access token. Missing email is NOT fatal — it just comes back null and
 * the status card hides the "Connected as <email>" line.
 */
export async function exchangeCodeForTokens(
  env: GoogleOAuthEnv,
  code: string,
): Promise<ExchangedTokens> {
  const client = buildOAuth2Client(env);
  const { tokens } = await withTimeout(client.getToken(code), "google.getToken");
  if (!tokens.refresh_token) {
    throw new Error("google: token response missing refresh_token");
  }
  if (!tokens.access_token) {
    throw new Error("google: token response missing access_token");
  }
  const email = extractEmailFromIdToken(tokens.id_token) ?? null;
  return {
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token,
    email,
    scope: tokens.scope ?? "",
  };
}

export interface CalendarExistsResult {
  exists: boolean;
}

/**
 * Check whether a previously-created calendar still exists in Google. Used
 * on reconnect so we reuse an id when the calendar is still there and only
 * create a new one when it was deleted out-of-band.
 */
export async function calendarExists(
  env: GoogleOAuthEnv,
  accessToken: string,
  calendarId: string,
): Promise<CalendarExistsResult> {
  const client = buildOAuth2Client(env);
  client.setCredentials({ access_token: accessToken });
  const api = calendarApi({ version: "v3", auth: client });
  try {
    await withTimeout(api.calendars.get({ calendarId }), "google.calendars.get");
    return { exists: true };
  } catch (err: unknown) {
    const status = (err as { code?: number; status?: number }).code ?? (err as { status?: number }).status;
    if (status === 404 || status === 410) return { exists: false };
    throw err;
  }
}

/**
 * Create the dedicated "Axiom Aquatics Lessons" calendar and return its id.
 */
export async function createDedicatedCalendar(
  env: GoogleOAuthEnv,
  accessToken: string,
): Promise<{ id: string }> {
  const client = buildOAuth2Client(env);
  client.setCredentials({ access_token: accessToken });
  const api = calendarApi({ version: "v3", auth: client });
  const resp = await withTimeout(
    api.calendars.insert({
      requestBody: {
        summary: CALENDAR_SUMMARY,
        description: CALENDAR_DESCRIPTION,
        timeZone: CALENDAR_TIME_ZONE,
      },
    }),
    "google.calendars.insert",
  );
  if (!resp.data.id) {
    throw new Error("google: calendars.insert returned no id");
  }
  return { id: resp.data.id };
}

/**
 * Revoke a refresh (or access) token. Called on explicit disconnect so the
 * coach's grant is removed from their Google account page. Failures here
 * must not block the local delete — the caller logs and continues.
 */
export async function revokeToken(env: GoogleOAuthEnv, token: string): Promise<void> {
  const client = buildOAuth2Client(env);
  await withTimeout(client.revokeToken(token), "google.revokeToken");
}

/**
 * Signals that Google rejected the refresh token (`invalid_grant`). Callers
 * use this to decide whether to flip the integration row to `needs_reconnect`
 * vs. recording an ordinary `sync_failed` on the lesson.
 */
export class GoogleInvalidGrantError extends Error {
  constructor(message = "google: invalid_grant") {
    super(message);
    this.name = "GoogleInvalidGrantError";
  }
}

/**
 * Refresh an access token using a stored refresh token. Throws
 * `GoogleInvalidGrantError` when Google returns `invalid_grant` (coach
 * revoked out-of-band), otherwise lets gaxios errors propagate.
 */
export async function refreshAccessToken(
  env: GoogleOAuthEnv,
  refreshToken: string,
): Promise<{ accessToken: string }> {
  const client = buildOAuth2Client(env);
  client.setCredentials({ refresh_token: refreshToken });
  try {
    const { credentials } = await withTimeout(
      client.refreshAccessToken(),
      "google.refreshAccessToken",
    );
    if (!credentials.access_token) {
      throw new Error("google: refreshAccessToken returned no access_token");
    }
    return { accessToken: credentials.access_token };
  } catch (err: unknown) {
    const safe = toSafeGoogleError(err);
    if (safe.googleErrorCode === "invalid_grant") {
      throw new GoogleInvalidGrantError(safe.message);
    }
    throw err;
  }
}

export interface CalendarEventBody {
  summary: string;
  description: string;
  location: string;
  startIso: string;
  endIso: string;
  timeZone: string;
}

/**
 * Create or update an event. Idempotent via the caller-supplied event id:
 * if `events.insert` returns 409 (event already exists for this id) we fall
 * through to `events.patch` with the same body. Any other error propagates.
 *
 * Both bodies include `status: "confirmed"`. Google soft-deletes events: a
 * hand-deleted event becomes `status: "cancelled"` under the same id, so
 * `events.insert` returns 409 and the fallback patch would otherwise leave
 * the event invisible. Setting status on every write restores a cancelled
 * event and is a no-op on an already-confirmed one.
 */
export async function upsertEvent(
  env: GoogleOAuthEnv,
  accessToken: string,
  calendarId: string,
  eventId: string,
  body: CalendarEventBody,
): Promise<void> {
  const api = buildCalendarApi(env, accessToken);
  const requestBody = {
    id: eventId,
    status: "confirmed",
    summary: body.summary,
    description: body.description,
    location: body.location,
    start: { dateTime: body.startIso, timeZone: body.timeZone },
    end: { dateTime: body.endIso, timeZone: body.timeZone },
  };
  try {
    await withTimeout(
      api.events.insert({ calendarId, requestBody }),
      "google.events.insert",
    );
    return;
  } catch (err: unknown) {
    const status = (err as { code?: number; status?: number }).code ?? (err as { status?: number }).status;
    if (status !== 409) throw err;
  }
  // 409 → event already exists for this id (possibly in `cancelled` state
  // after a hand-delete). Patch with status=confirmed un-cancels it.
  await withTimeout(
    api.events.patch({
      calendarId,
      eventId,
      requestBody: {
        status: "confirmed",
        summary: body.summary,
        description: body.description,
        location: body.location,
        start: { dateTime: body.startIso, timeZone: body.timeZone },
        end: { dateTime: body.endIso, timeZone: body.timeZone },
      },
    }),
    "google.events.patch",
  );
}

/**
 * Delete an event by id. Idempotent: 404 (never existed) and 410 (already
 * gone) are treated as success. Any other error propagates.
 */
export async function deleteEventIdempotent(
  env: GoogleOAuthEnv,
  accessToken: string,
  calendarId: string,
  eventId: string,
): Promise<void> {
  const api = buildCalendarApi(env, accessToken);
  try {
    await withTimeout(
      api.events.delete({ calendarId, eventId }),
      "google.events.delete",
    );
  } catch (err: unknown) {
    const status = (err as { code?: number; status?: number }).code ?? (err as { status?: number }).status;
    if (status === 404 || status === 410) return;
    throw err;
  }
}

function buildCalendarApi(env: GoogleOAuthEnv, accessToken: string) {
  const client = buildOAuth2Client(env);
  client.setCredentials({ access_token: accessToken });
  return calendarApi({ version: "v3", auth: client });
}

export interface SafeGoogleError {
  message: string;
  status: number | undefined;
  googleErrorCode: string | undefined;
}

/**
 * Flatten a gaxios/google-auth-library error into a safe shape for logging.
 *
 * `googleapis` errors carry a `.config` object (headers like `Authorization`,
 * request body with the auth code, URL + params), `.request`, and `.response`
 * trees that bleed secrets into logs. This helper picks the three fields we
 * actually need — status code, Google's `error` string, and a short message —
 * and drops everything else. The raw error object is never returned.
 *
 * `message` is `.response.data.error_description` first (most useful), then
 * `.message`, then `String(err)`. Known secret-shaped substrings are
 * belt-and-suspenders scrubbed in case Google ever echoes the auth code back
 * in `error_description`.
 */
export function toSafeGoogleError(err: unknown): SafeGoogleError {
  // Null/undefined/primitives short-circuit — they can't carry secret-shaped
  // config either, and `err.message` would TypeError on undefined.
  if (err === null || err === undefined) {
    return { message: String(err), status: undefined, googleErrorCode: undefined };
  }
  if (typeof err !== "object" && !(err instanceof Error)) {
    return { message: String(err), status: undefined, googleErrorCode: undefined };
  }
  const anyErr = err as {
    message?: unknown;
    code?: unknown;
    status?: unknown;
    response?: { status?: unknown; data?: { error?: unknown; error_description?: unknown } };
  };
  const status =
    typeof anyErr.status === "number"
      ? anyErr.status
      : typeof anyErr.response?.status === "number"
        ? anyErr.response.status
        : typeof anyErr.code === "number"
          ? anyErr.code
          : undefined;
  const googleErrorCode =
    typeof anyErr.response?.data?.error === "string" ? anyErr.response.data.error : undefined;
  const rawMessage =
    (typeof anyErr.response?.data?.error_description === "string"
      ? anyErr.response.data.error_description
      : undefined) ??
    (typeof anyErr.message === "string" ? anyErr.message : undefined) ??
    (err instanceof Error ? err.message : String(err));

  return {
    message: scrubSecretShapedTokens(rawMessage),
    status,
    googleErrorCode,
  };
}

// Belt-and-suspenders: Google error messages shouldn't contain the auth code
// or a Bearer token, but if they ever do, replace them with [REDACTED] rather
// than letting the string reach a log sink. Patterns match long base64url
// strings in Bearer headers and `code=` query fragments.
function scrubSecretShapedTokens(input: string): string {
  // Bearer tokens: `Bearer <alnum/.-_~+/>`
  // Auth codes: `code=<alnum/.-_~+/>` — includes `%` so URL-encoded forms
  // (code=4%2F0AY…) are matched too.
  return input
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]{10,}/g, "Bearer [REDACTED]")
    .replace(/\bcode=[A-Za-z0-9._~+/%-]{10,}/g, "code=[REDACTED]");
}

function buildOAuth2Client(env: GoogleOAuthEnv) {
  return new googleAuth.OAuth2(env.clientId, env.clientSecret, env.redirectUri);
}

// Decode a Google ID token's `email` claim without verifying the signature.
// The id_token comes from Google's own token endpoint over TLS in direct
// response to our own token exchange, so a signature verify would only
// defend against a Google-side compromise, which is not in our threat model
// for a display-only email. The alternative (`verifyIdToken`) adds a public
// key fetch per connect which we don't need.
function extractEmailFromIdToken(idToken: string | null | undefined): string | undefined {
  if (!idToken) return undefined;
  const parts = idToken.split(".");
  if (parts.length !== 3) return undefined;
  const payloadPart = parts[1];
  if (!payloadPart) return undefined;
  try {
    const padded = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
    const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
    const payload = JSON.parse(Buffer.from(padded + pad, "base64").toString("utf8")) as {
      email?: unknown;
    };
    return typeof payload.email === "string" ? payload.email : undefined;
  } catch {
    return undefined;
  }
}
