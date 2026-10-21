import { z } from "zod";

/**
 * Shared schemas for the Google Calendar coach integration (ADR 027).
 *
 * Phase 1 only exposes OAuth start, OAuth callback, status, and disconnect.
 * Retry and the failed-lessons list are intentionally out of scope here —
 * they are added by a later phase.
 */

export const GoogleOAuthStartQuerySchema = z.object({
  /**
   * Where to redirect the browser after the OAuth callback finishes.
   * Must be an app-local path. Validated by the API before use.
   */
  returnTo: z.string().startsWith("/").max(200).optional(),
});
export type GoogleOAuthStartQuery = z.infer<typeof GoogleOAuthStartQuerySchema>;

export const GoogleOAuthCallbackQuerySchema = z.object({
  code: z.string().optional(),
  state: z.string(),
  // Google sends `error=access_denied` when the user cancels consent.
  error: z.string().optional(),
  error_description: z.string().optional(),
});
export type GoogleOAuthCallbackQuery = z.infer<typeof GoogleOAuthCallbackQuerySchema>;

/**
 * `not_connected` — no integration row; the connect button is shown.
 * `active` — row exists and the token last worked; sync hooks run normally.
 * `needs_reconnect` — refresh returned invalid_grant; the Reconnect button
 *                     is shown. The dedicated calendar id is preserved.
 * `not_configured` — the API is missing one or more Google env vars.
 *                    The card is hidden entirely in this state.
 */
export const GoogleCalendarStatusSchema = z.enum([
  "not_connected",
  "active",
  "needs_reconnect",
  "not_configured",
]);
export type GoogleCalendarStatus = z.infer<typeof GoogleCalendarStatusSchema>;

export const GoogleCalendarStatusResponseSchema = z.object({
  status: GoogleCalendarStatusSchema,
  connectedAccountEmail: z.string().email().nullable(),
  connectedAt: z.string().datetime().nullable(),
  googleCalendarId: z.string().nullable(),
  lastSyncAttemptedAt: z.string().datetime().nullable(),
  lastSyncSucceededAt: z.string().datetime().nullable(),
  needsReconnectSince: z.string().datetime().nullable(),
});
export type GoogleCalendarStatusResponse = z.infer<typeof GoogleCalendarStatusResponseSchema>;
