import { z } from "zod";

/**
 * Shared schemas for the Google Calendar coach integration (ADR 027).
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
  // Counts over this coach's upcoming approved lessons so the card can
  // show "Syncing N of M…" during backfill and a "N failed to sync" chip.
  upcomingLessonCount: z.number().int().nonnegative(),
  syncedCount: z.number().int().nonnegative(),
  pendingSyncCount: z.number().int().nonnegative(), // not_synced
  failedLessonCount: z.number().int().nonnegative(), // sync_failed
  // Server-authoritative: true while a backfill or retry run is in flight.
  // The UI uses this to drive the syncing banner — NOT pendingSyncCount,
  // which can be stuck when a run crashed. The server returns false when
  // the run's sync_run_started_at marker is older than 2 minutes with no
  // fresh progress, treating a crashed/restarted API as a finished run.
  syncRunInProgress: z.boolean(),
});
export type GoogleCalendarStatusResponse = z.infer<typeof GoogleCalendarStatusResponseSchema>;

export const RetryAllFailedResponseSchema = z.object({
  attempted: z.number().int().nonnegative(),
  succeeded: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});
export type RetryAllFailedResponse = z.infer<typeof RetryAllFailedResponseSchema>;
