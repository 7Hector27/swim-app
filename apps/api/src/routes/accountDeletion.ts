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
  DELETION_CONFIRMATION_PHRASE,
  DeletionConfirmBodySchema,
  type DeletionConfirmBody,
  type DeletionPreviewResponse,
} from "@swim-app/shared";

import { db } from "../db/client";
import { accountDeletionJobs } from "../db/schema";
import { getEnv } from "../lib/env";
import { nowUtc as getNowUtc } from "../lib/clock";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireUser } from "../middleware/requireUser";
import { validate } from "../middleware/validate";
import { accountDeletionConfirmLimiter } from "../middleware/accountDeletionRateLimit";
import {
  AlreadyDeletedError,
  OwnerMustTransferFirstError,
  previewAccountDeletion,
  runAccountDeletion,
  runAccountDeletionCleanup,
} from "../services/accountDeletion";

export const accountDeletionRouter = Router();

// ── POST /me/deletion/preview ────────────────────────────────────────────────

accountDeletionRouter.post(
  "/me/deletion/preview",
  requireUser,
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
  accountDeletionConfirmLimiter,
  validate({ body: DeletionConfirmBodySchema }),
  asyncHandler(async (req, res) => {
    const body = req.body as DeletionConfirmBody;

    // Typed-phrase check first — cheap, no network call, no password leak
    // risk if the caller typed the wrong phrase but a right-ish password.
    if (body.confirmationPhrase !== DELETION_CONFIRMATION_PHRASE) {
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
    try {
      await authCheckClient.auth.signOut();
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
    res.status(204).end();

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

    void (async () => {
      const cleanup = await runAccountDeletionCleanup(
        { id: jobId, authUserId, scope: result.scope, anonymizedLessonIds },
        log,
      );
      if (cleanup.allOk) {
        try {
          await db
            .update(accountDeletionJobs)
            .set({ status: "completed", completedAt: new Date(), lastError: null })
            .where(eq(accountDeletionJobs.id, jobId));
        } catch (err) {
          log.error(
            { event: "account_deletion_job_mark_completed_failed", jobId, err: safeErrSummary(err) },
            "mark completed failed",
          );
        }
      } else {
        try {
          // sql`attempts + 1` so a later retry-drain pass increments
          // without overwriting. First failure here lifts attempts from
          // 0 → 1; the drain takes it from there with the same
          // increment expression.
          await db
            .update(accountDeletionJobs)
            .set({
              attempts: sql`${accountDeletionJobs.attempts} + 1`,
              lastError: cleanup.lastError,
            })
            .where(eq(accountDeletionJobs.id, jobId));
        } catch (err) {
          log.error(
            { event: "account_deletion_job_mark_pending_failed", jobId, err: safeErrSummary(err) },
            "mark pending failed",
          );
        }
      }
    })();
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
