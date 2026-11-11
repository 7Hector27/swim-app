// Account deletion routes (ADR 034).
//
// POST /me/deletion/preview — returns counts and the owner-blocked flag
// so the confirmation screen can render.
// POST /me/deletion/confirm — server-side re-auth + typed-phrase check,
// then runs the deletion transaction. On commit, post-commit microtasks
// hard-delete the Supabase Auth user and sync the cancelled lessons off
// the coach's Google Calendar. Response is 204 regardless of post-commit
// success — the DB side has committed, and account_deletion_jobs carries
// the retry state if any external call fails.

import { Router } from "express";
import { createClient } from "@supabase/supabase-js";
import { eq, sql } from "drizzle-orm";

import {
  DeletionConfirmBodySchema,
  matchesDeletionConfirmationPhrase,
  type DeletionConfirmBody,
  type DeletionPreviewResponse,
} from "@swim-app/shared";

import { db } from "../db/client";
import { accountDeletionJobs } from "../db/schema";
import { getEnv } from "../lib/env";
import { nowUtc as getNowUtc } from "../lib/clock";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireParent } from "../middleware/requireParent";
import { requireUser } from "../middleware/requireUser";
import { validate } from "../middleware/validate";
import { accountDeletionConfirmLimiter } from "../middleware/accountDeletionRateLimit";
import {
  AlreadyDeletedError,
  OwnerMustTransferFirstError,
  computeAccountDeletionBackoffSeconds,
  previewAccountDeletion,
  runAccountDeletion,
  runAccountDeletionCleanup,
  ROUTE_POST_COMMIT_FAILURE_BACKOFF_SECONDS,
} from "../services/accountDeletion";
import { kickCashRefundDrain } from "../services/balance";
import { sendLessonEmailOutboxRow } from "../services/emails/sender";

export const accountDeletionRouter = Router();

// ── POST /me/deletion/preview ────────────────────────────────────────────────

accountDeletionRouter.post(
  "/me/deletion/preview",
  requireUser,
  // Parent-only. The UI already hides the deletion section for coaches
  // (AccountContent.tsx), but the API must enforce it independently —
  // a coach token calling this directly would otherwise reach
  // previewAccountDeletion with a profile that has no household row,
  // and a subsequent /confirm would scrub the coach profile and
  // enqueue auth.admin.deleteUser against the coach's auth user.
  requireParent,
  validate({}),
  asyncHandler(async (req, res) => {
    const preview = await db.transaction(async (tx) =>
      previewAccountDeletion(tx, req.profile.id, getNowUtc()),
    );
    const body: DeletionPreviewResponse = preview;
    res.json(body);
  }),
);

// ── POST /me/deletion/confirm ────────────────────────────────────────────────

accountDeletionRouter.post(
  "/me/deletion/confirm",
  requireUser,
  // Parent-only — same reason as /preview above. requireParent runs
  // before the rate limiter so a coach token never consumes a slot.
  requireParent,
  accountDeletionConfirmLimiter,
  validate({ body: DeletionConfirmBodySchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as DeletionConfirmBody;

    // Typed-phrase check first — cheap, no network call, no password leak
    // risk if the caller typed the wrong phrase but a right-ish password.
    // Comparison is trimmed + case-insensitive so an iPhone-autocapitalized
    // "Delete my account" passes; the shared helper is the single source
    // of truth so client / Server Action / API all agree on what counts
    // as a match.
    if (!matchesDeletionConfirmationPhrase(body.confirmationPhrase)) {
      res.status(422).json({ error: "confirmation_phrase_mismatch" });
      return;
    }

    // Re-auth against Supabase using a non-persisting client — no session
    // is kept after the check, so the audit user doesn't end up with a
    // second active refresh token lying around. ADR 034 addition 3.
    const env = getEnv();
    const authCheckClient = createClient(env.supabaseUrl, env.supabasePublishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await authCheckClient.auth.signInWithPassword({
      email: req.userEmail,
      password: body.password,
    });
    // Sign the re-auth client out regardless of outcome. persistSession:
    // false stops client-side storage, but the signInWithPassword call
    // still creates a real server-side session with a refresh token;
    // signOut invalidates it so a failed deleteUser retry window doesn't
    // leave a second live session attached to a deleted account.
    //
    // CRITICAL: scope "local". Supabase's default scope is "global",
    // which revokes EVERY refresh token for this user — including the
    // one the parent's browser is using. The practical effect of the
    // default was: any failed confirm (wrong password, 500 mid-tx)
    // signed the parent out of their live browser session. The API-
    // side re-auth client only owns the one session it just minted;
    // scope "local" ends only that session and leaves the browser
    // alone. Tested at the route level in accountDeletionRoute.test.ts.
    try {
      await authCheckClient.auth.signOut({ scope: "local" });
    } catch {
      /* best-effort — nothing we can do with a sign-out failure here */
    }
    if (authError || !authData?.user) {
      // Intentionally NOT 401 — the web client's convention is that any
      // 401 from an API call signals "your session is dead, sign the
      // user out" (apps/web/src/lib/requireAuth.ts and every Server
      // Action that forwards to the API). A wrong password on the
      // deletion confirmation must not sign the authenticated user out
      // of the rest of their account; 403 with a distinct code
      // keeps the UX scoped to the deletion flow.
      //
      // NEVER include `req.userEmail` in this log line (or any log line
      // in this handler). It's attached to req by requireUser and is
      // in-scope here, but docs/accounts.md requires that email
      // addresses never reach a log. The profile id is a UUID; that's
      // the only correlator this warning needs. The rate limiter is
      // keyed on the same profile id and will fire at 5 attempts so
      // this log line can't be used to brute-force a known account.
      req.log.warn({ profileId: req.profile.id, reason: "invalid_password" }, "deletion re-auth failed");
      res.status(403).json({ error: "invalid_password" });
      return;
    }

    // Supabase's trigger mirrors auth.users.id into profiles.id so these
    // should always match in a correctly-provisioned account. Defense in
    // depth: if they ever diverge (a profile row with a repointed id, a
    // test env that bypasses the trigger), passing the wrong UUID to the
    // Admin API's deleteUser later would silently wipe the wrong auth
    // user. Abort the request before any mutation runs; log the pair of
    // ids (UUIDs only, no PII) so the discrepancy is traceable.
    const authUserId = authData.user.id;
    if (authUserId !== req.profile.id) {
      req.log.error(
        { event: "account_deletion_id_mismatch", profileId: req.profile.id, authUserId },
        "deletion aborted: auth user id does not match profile id",
      );
      res.status(500).json({ error: "account_deletion_id_mismatch" });
      return;
    }

    const now = getNowUtc();

    let result;
    try {
      result = await db.transaction(async (tx) => runAccountDeletion(tx, req.profile.id, authUserId, now));
    } catch (err) {
      if (err instanceof OwnerMustTransferFirstError) {
        res.status(409).json({ error: "must_transfer_first" });
        return;
      }
      if (err instanceof AlreadyDeletedError) {
        res.status(409).json({ error: "already_deleted" });
        return;
      }
      throw err;
    }

    // Respond before the external cleanup runs — the DB side has committed
    // and account_deletion_jobs is the authoritative state for the external
    // calls. A terminal retry failure logs at error level (see post-commit
    // branch below); Jason can't fix a Supabase or Google outage from an
    // alert anyway, so there is no coach notification path.
    //
    // ADR 036 Phase 8 Part B Stop 2: when a cash-out actually ran we
    // switch to 200 JSON with the breakdown so the UI can render the
    // refund amounts on the deletion-complete screen. Zero-balance,
    // leave, and orphan paths keep the existing 204-no-body shape so
    // every existing caller keeps working unchanged.
    // `drainEligibleJobIds` is server-internal — strip it from the
    // response body so the client contract stays `{ breakdown,
    // refundJobCount, needsManualHandlingCents }`.
    if (result.cashOut !== null) {
      const { drainEligibleJobIds: _drainEligibleJobIds, ...publicCashOut } =
        result.cashOut;
      res.status(200).json({ cashOut: publicCashOut });
    } else {
      res.status(204).end();
    }

    // Solo path only: coach-side "A family deleted their account" email
    // (ADR 034). The outbox row was written inside the deletion tx, so
    // it is already durable; this microtask just drives an immediate
    // send. The drain is the fallback if the microtask fails.
    if (result.coachAccountDeletedOutboxId !== null) {
      const emailOutboxId = result.coachAccountDeletedOutboxId;
      queueMicrotask(() => { void sendLessonEmailOutboxRow(emailOutboxId); });
    }

    // ADR 036 Phase 8 Part B: kick the cash-refund drain with the
    // just-written job ids so Stripe refunds fire immediately rather
    // than waiting for the next cron tick (the service seeds a
    // 2-minute lead on `next_attempt_at` for cron-race safety; passing
    // ids bypasses that filter for the kick). Needs-manual-handling
    // residual jobs aren't in `drainEligibleJobIds`, so the kick
    // only touches rows with a real payment intent.
    if (
      result.cashOut !== null
      && result.cashOut.drainEligibleJobIds.length > 0
    ) {
      kickCashRefundDrain(req.log, result.cashOut.drainEligibleJobIds);
    }

    // Post-commit fan-out. The shared cleanup helper walks every
    // anonymized lesson id (past → patch Google event; future → delete)
    // and hard-deletes the Supabase auth user. Each step is idempotent
    // and logged through safe summaries — raw err objects never reach
    // the log. The retry drain (/internal/cron/tick) runs the exact
    // same helper for pending jobs, so a failed first attempt here
    // keeps the row at status='pending' and the drain re-drives it on
    // the next tick until success or MAX_ATTEMPTS.
    const jobId = result.jobId;
    const anonymizedLessonIds = [...result.anonymizedLessonIds];
    const log = req.log;

    // Top-level catch on the voided promise so a synchronous throw
    // from the IIFE body itself (anything before the first await, or
    // a non-retryable throw from runAccountDeletionCleanup) does NOT
    // reach Node's unhandledRejection. The inner try/catches around
    // each DB update already handle their own failures; this is the
    // defense for failures that happen between those blocks or in
    // runAccountDeletionCleanup itself.
    void (async () => {
      const cleanup = await runAccountDeletionCleanup(
        { id: jobId, authUserId, scope: result.scope, anonymizedLessonIds },
        log,
      );
      if (cleanup.allOk) {
        try {
          await db
            .update(accountDeletionJobs)
            .set({
              status: "completed",
              completedAt: new Date(),
              lastError: null,
              nextAttemptAt: null,
            })
            .where(eq(accountDeletionJobs.id, jobId));
        } catch (err) {
          log.error(
            { event: "account_deletion_job_mark_completed_failed", jobId, err: safeErrSummary(err) },
            "mark completed failed",
          );
        }
      } else if (cleanup.paused) {
        // Jason's Google integration isn't connected right now (common —
        // the Testing-mode OAuth token expires weekly). No real error,
        // so don't consume an attempt — just push next_attempt_at out
        // by the first-backoff window and let the drain re-check. Once
        // Jason reconnects, the next tick resolves cleanly.
        try {
          await db
            .update(accountDeletionJobs)
            .set({
              lastError: "paused:integration_needs_reconnect",
              nextAttemptAt: new Date(
                Date.now() + ROUTE_POST_COMMIT_FAILURE_BACKOFF_SECONDS * 1000,
              ),
            })
            .where(eq(accountDeletionJobs.id, jobId));
        } catch (err) {
          log.error(
            { event: "account_deletion_job_mark_paused_failed", jobId, err: safeErrSummary(err) },
            "mark paused failed",
          );
        }
      } else {
        try {
          // sql`attempts + 1` so a later retry-drain pass increments
          // without overwriting. First failure here lifts attempts from
          // 0 → 1; the drain takes it from there with the same
          // increment expression. next_attempt_at is seeded with the
          // attempts=1 backoff so the drain doesn't re-pick this row
          // within the same minute.
          await db
            .update(accountDeletionJobs)
            .set({
              attempts: sql`${accountDeletionJobs.attempts} + 1`,
              lastError: cleanup.lastError,
              nextAttemptAt: new Date(
                Date.now() + computeAccountDeletionBackoffSeconds(1) * 1000,
              ),
            })
            .where(eq(accountDeletionJobs.id, jobId));
        } catch (err) {
          log.error(
            { event: "account_deletion_job_mark_pending_failed", jobId, err: safeErrSummary(err) },
            "mark pending failed",
          );
        }
      }
    })().catch((err: unknown) => {
      // Last-resort guard. runAccountDeletionCleanup swallows its own
      // errors and returns a result object, so this catch should never
      // actually fire today — but a future refactor that lets an error
      // escape the IIFE body would otherwise crash the Node process
      // via unhandledRejection. Log a safe summary and move on; the
      // drain will re-drive the row from status='pending' on the next
      // tick.
      log.error(
        { event: "account_deletion_post_commit_unhandled", jobId, err: safeErrSummary(err) },
        "post-commit fan-out threw",
      );
    });
  }),
);

// Structural summary of an arbitrary thrown value. Never includes the
// raw message — Supabase Admin API errors can echo the user's email in
// .message, and Google API errors can embed swimmer first names from
// event titles (ADR 027). Fields are UUID-safe strings or small codes.
export function safeErrSummary(err: unknown): { name: string; code: string | null; status: number | null } {
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

// Supabase Admin API errors have the same shape as a generic Error with
// a `.status` field; the helper above handles them. Kept as a named
// export so the intent reads clearly at the call site.
export const safeSupabaseErrSummary = safeErrSummary;
