// External cleanup for an account_deletion_jobs row (ADR 034 Phase 3).
//
// Both the route's post-commit fan-out and the cron retry drain call
// `runAccountDeletionCleanup` so the two paths never drift. The function:
//
//   1. Walks every anonymized lesson id: past → patch Google event to
//      the "deleted family" shape; future → delete the event. The
//      per-lesson reconcile is itself idempotent (deleteEventIdempotent
//      / patchEventIdempotent treat 404/410 as success).
//   2. Hard-deletes the Supabase auth user. A `user_not_found` response
//      from the Admin API is treated as success: the previous attempt
//      got far enough to delete the user and a later tick is seeing
//      the second half of the retry succeed. Same rule for an
//      HTTP-404-shaped error object.
//
// Return value is a boolean "all succeeded" plus the first error's
// safe summary (name/code/status only, never a Supabase .message that
// could echo the user's email). Callers use the summary as
// account_deletion_jobs.last_error and the boolean to decide between
// 'completed' and leaving the row 'pending' for a later retry.

import type { Logger } from "pino";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  syncAnonymizedLessonToCalendar as defaultSyncAnonymizedLessonToCalendar,
  type AnonymizedCalendarSyncOutcome,
} from "../googleCalendarSync";
import { supabaseAdmin as defaultSupabaseAdmin } from "../../lib/supabaseAdmin";

export interface AccountDeletionCleanupJob {
  id: string;
  authUserId: string;
  scope: string;
  anonymizedLessonIds: string[];
}

export interface AccountDeletionCleanupDeps {
  // Injected so tests can mock Google + Supabase without reaching for
  // vi.mock on the import site — and so the retry drain and the route
  // route through the same dependency surface.
  syncAnonymizedLessonToCalendar?: (lessonId: string) => Promise<AnonymizedCalendarSyncOutcome>;
  supabaseAdmin?: SupabaseClient;
}

export interface AccountDeletionCleanupResult {
  // Every step finished (lessons reconciled AND the auth user is gone
  // or was already gone). Drain flips the row to 'completed' when true.
  allOk: boolean;
  // No real error occurred, but at least one calendar step reported
  // integration_paused (disconnected / needs_reconnect / missing-tokens
  // / invalid_grant). Only meaningful when `allOk` is false AND
  // `lastError` is null — the drain uses it to push next_attempt_at
  // out by a short recheck window WITHOUT incrementing attempts, so
  // Jason's weekly OAuth reconnect doesn't burn the retry budget.
  paused: boolean;
  // First structural failure summary from a real error path (a thrown
  // calendar error, a non-idempotent Supabase admin failure). Null
  // when all non-successes were paused signals. Short, no PII, no raw
  // .message — written into account_deletion_jobs.last_error.
  lastError: string | null;
}

// Structural summary of an arbitrary thrown value or Supabase error
// object. Never includes the raw .message — Supabase Admin API errors
// can echo the user's email, and Google API errors can embed swimmer
// first names from event titles. Mirrors the helper in the route file,
// kept co-located here so the cleanup module has no cross-file dep on
// an export that's otherwise unrelated.
function safeSummary(err: unknown): { name: string; code: string | null; status: number | null } {
  if (err && typeof err === "object") {
    const name = (err as { name?: unknown }).name;
    const code = (err as { code?: unknown }).code;
    const status = (err as { status?: unknown }).status;
    return {
      name: typeof name === "string" ? name : "Error",
      code: typeof code === "string" ? code : null,
      status: typeof status === "number" ? status : null,
    };
  }
  return { name: "Error", code: null, status: null };
}

function isAlreadyDeletedAuthUserError(err: {
  code?: unknown;
  status?: unknown;
  name?: unknown;
}): boolean {
  // Supabase Admin API returns `user_not_found` with HTTP 404 when the
  // auth user doesn't exist. Either signal on its own is sufficient —
  // code is the preferred match; status covers raw-HTTP errors a stub
  // might throw without the code field.
  if (err.code === "user_not_found") return true;
  if (typeof err.status === "number" && err.status === 404) return true;
  return false;
}

export async function runAccountDeletionCleanup(
  job: AccountDeletionCleanupJob,
  log: Logger,
  deps: AccountDeletionCleanupDeps = {},
): Promise<AccountDeletionCleanupResult> {
  const syncFn = deps.syncAnonymizedLessonToCalendar ?? defaultSyncAnonymizedLessonToCalendar;
  const admin = deps.supabaseAdmin ?? defaultSupabaseAdmin;

  let firstError: string | null = null;
  // Any `integration_paused` outcome from the calendar step means there's
  // work still outstanding but nothing to actually retry — Jason's
  // Google OAuth needs reconnecting. The drain uses this to defer the
  // job's next attempt by a short recheck window without counting it.
  let anyCalendarPaused = false;
  // Track whether every lesson reconciled cleanly. If any lesson threw
  // OR returned paused, we have outstanding calendar work and the job
  // cannot complete yet.
  let allLessonsReconciled = true;

  // Per-lesson calendar reconcile. One failure never blocks the others
  // — a Google 5xx on event A still lets event B get patched or deleted.
  // Paused outcomes are also not blocking per se (next lesson might
  // succeed), but they prevent the overall job from completing on this
  // pass.
  for (const lessonId of job.anonymizedLessonIds) {
    try {
      const outcome = await syncFn(lessonId);
      if (outcome.status === "integration_paused") {
        // Narrow check (not `outcome.status !== "reconciled"`) so a future
        // AnonymizedCalendarSyncOutcome variant (e.g. `skipped`,
        // `not_configured`) can't be silently reinterpreted as paused.
        // Adding a new variant will now be a type error at this line.
        anyCalendarPaused = true;
        allLessonsReconciled = false;
      } else if (outcome.status !== "reconciled") {
        // Exhaustiveness guard: if a future outcome shape slips through
        // without an explicit handler, treat it as a real problem rather
        // than silently succeeding. TypeScript catches this at compile
        // time; the runtime fallback is here for a stray build.
        allLessonsReconciled = false;
      }
    } catch (err) {
      allLessonsReconciled = false;
      const summary = safeSummary(err);
      log.error(
        { event: "account_deletion_calendar_sync_failed", jobId: job.id, lessonId, err: summary },
        "google sync failed",
      );
      if (firstError === null) {
        firstError = `calendar_sync_failed:${summary.name}:${summary.code ?? "_"}:${summary.status ?? "_"}`;
      }
    }
  }

  // Auth user hard-delete. The admin client returns a `{ data, error }`
  // tuple on success/known failure, and throws on transport errors. Both
  // branches collapse `user_not_found` / 404 to success.
  let authDeleted = true;
  try {
    const { error: deleteErr } = await admin.auth.admin.deleteUser(job.authUserId);
    if (deleteErr) {
      const errRecord = deleteErr as { code?: unknown; status?: unknown; name?: unknown };
      if (!isAlreadyDeletedAuthUserError(errRecord)) {
        authDeleted = false;
        const summary = safeSummary(deleteErr);
        log.error(
          { event: "account_deletion_auth_delete_failed", jobId: job.id, err: summary },
          "auth user delete failed",
        );
        if (firstError === null) {
          firstError = `auth_delete_failed:${summary.name}:${summary.code ?? "_"}:${summary.status ?? "_"}`;
        }
      }
    }
  } catch (err) {
    const errRecord = err as { code?: unknown; status?: unknown; name?: unknown };
    if (!isAlreadyDeletedAuthUserError(errRecord)) {
      authDeleted = false;
      const summary = safeSummary(err);
      log.error(
        { event: "account_deletion_auth_delete_failed", jobId: job.id, err: summary },
        "auth user delete threw",
      );
      if (firstError === null) {
        firstError = `auth_delete_threw:${summary.name}:${summary.code ?? "_"}:${summary.status ?? "_"}`;
      }
    }
  }

  const allOk = allLessonsReconciled && authDeleted;
  // "Paused" is only the final determination when nothing else failed.
  // A calendar-paused + auth-succeeded run is paused. A calendar-paused
  // + auth-failed run is a real error — count the attempt, apply the
  // exponential backoff — because the auth step is what's actually
  // broken and needs retrying.
  const paused = !allOk && firstError === null && anyCalendarPaused;

  return { allOk, paused, lastError: firstError };
}

/** Exported for the route's existing safeErrSummary shim. */
export { safeSummary as safeCleanupErrSummary };
