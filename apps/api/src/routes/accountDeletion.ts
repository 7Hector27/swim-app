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
import { eq } from "drizzle-orm";

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
} from "../services/accountDeletion";
import { supabaseAdmin } from "../lib/supabaseAdmin";
import { syncLessonToGoogle } from "../services/googleCalendarSync";

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
    if (authError || !authData?.user) {
      req.log.warn({ profileId: req.profile.id, reason: "password_mismatch" }, "deletion re-auth failed");
      res.status(401).json({ error: "password_mismatch" });
      return;
    }

    const now = getNowUtc();

    let result;
    try {
      result = await db.transaction(async (tx) => runAccountDeletion(tx, req.profile.id, req.profile.id, now));
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

    // Post-commit fan-out. Each microtask swallows its own rejection so a
    // failing one does not take down the process; the job row stays at
    // status='pending' and the retry cron (Phase 3) picks it up.
    const jobId = result.jobId;
    const authUserId = req.profile.id;
    const lessonIdsToSync = [...result.cancelledFutureLessonIds];

    void (async () => {
      let allOk = true;
      for (const lessonId of lessonIdsToSync) {
        try {
          await syncLessonToGoogle(lessonId);
        } catch (err) {
          req.log.error({ event: "account_deletion_calendar_sync_failed", jobId, lessonId, err }, "google sync failed");
          allOk = false;
        }
      }
      try {
        const { error: deleteErr } = await supabaseAdmin.auth.admin.deleteUser(authUserId);
        if (deleteErr) {
          req.log.error({ event: "account_deletion_auth_delete_failed", jobId, err: deleteErr.message }, "auth user delete failed");
          allOk = false;
        }
      } catch (err) {
        req.log.error({ event: "account_deletion_auth_delete_failed", jobId, err }, "auth user delete threw");
        allOk = false;
      }
      if (allOk) {
        try {
          await db
            .update(accountDeletionJobs)
            .set({ status: "completed", completedAt: new Date() })
            .where(eq(accountDeletionJobs.id, jobId));
        } catch (err) {
          req.log.error({ event: "account_deletion_job_mark_completed_failed", jobId, err }, "mark completed failed");
        }
      } else {
        try {
          await db
            .update(accountDeletionJobs)
            .set({ attempts: 1, lastError: "post-commit fan-out failed; retry cron will re-drive" })
            .where(eq(accountDeletionJobs.id, jobId));
        } catch (err) {
          req.log.error({ event: "account_deletion_job_mark_pending_failed", jobId, err }, "mark pending failed");
        }
      }
    })();
  }),
);
