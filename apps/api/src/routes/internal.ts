import { Router } from "express";
import { createHash, timingSafeEqual } from "crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "../db/client";
import { coachCalendarIntegrations, lessons } from "../db/schema";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../middleware/asyncHandler";
import { getEnv } from "../lib/env";
import { chargeLessonComplete } from "../lib/lessonApproval";
import {
  runFullSyncPass,
  runLightSyncPass,
  syncLessonToGoogle,
} from "../services/googleCalendarSync";
import type { RequestHandler } from "express";

// Promote the per-tick light pass to a full pass when last_full_reconcile_at
// is older than this. 24 hours was chosen to catch drift (events deleted in
// Google, missed state changes) without a dedicated nightly worker.
const FULL_PASS_INTERVAL_MS = 24 * 60 * 60 * 1000;

export const internalRouter = Router();

// SHA-256 both values before comparing so timingSafeEqual always operates on
// fixed-length digests — eliminating the timing oracle that a direct
// variable-length string comparison would leak on length mismatch.
function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

const requireCronSecret: RequestHandler = (req, res, next) => {
  const secret = getEnv().cronSecret;
  const provided = req.headers["cron-secret"];
  if (
    !secret ||
    typeof provided !== "string" ||
    !timingSafeEqual(sha256(provided), sha256(secret))
  ) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
};

// POST /internal/cron/tick
// 1. Expire pending lessons whose expires_at < now().
// 2. Auto-complete approved lessons that have finished.
internalRouter.post(
  "/cron/tick",
  requireCronSecret,
  validate({}),
  asyncHandler(async (req, res) => {
    const now = new Date();

    const { expired, completed } = await db.transaction(async (tx) => {
      // Pass 1: expire pending lessons past their deadline.
      const expiredRows = await tx
        .update(lessons)
        .set({ status: "expired" })
        .where(
          and(
            eq(lessons.status, "pending"),
            lt(lessons.expiresAt, now),
          ),
        )
        .returning({ id: lessons.id });

      // Pass 2: auto-complete approved lessons whose end time has passed.
      const completedRows = await tx
        .update(lessons)
        .set({ status: "completed", completedAt: now })
        .where(
          and(
            eq(lessons.status, "approved"),
            sql`(${lessons.startsAt} + (${lessons.durationMinutes} * interval '1 minute')) < ${now.toISOString()}`,
          ),
        )
        .returning({ id: lessons.id });

      return { expired: expiredRows, completed: completedRows };
    });

    // Stubs: notifications (PR 7) and charges (PR 8).
    for (const row of completed) {
      chargeLessonComplete(row.id);
    }

    // Reconcile Google Calendar for every lesson whose status just changed.
    // Expired pending lessons normally have no event (reconcile short-
    // circuits). Completed lessons keep their event under the new rule
    // (approved + completed = event exists) and the reconcile just
    // confirms the state. Microtasks run after the response, independent
    // of the HTTP request lifecycle.
    for (const row of expired) {
      queueMicrotask(() => { void syncLessonToGoogle(row.id); });
    }
    for (const row of completed) {
      queueMicrotask(() => { void syncLessonToGoogle(row.id); });
    }

    // Schedule a batch sync pass for every active coach integration. The
    // tick always runs the cheap light pass (drains transient failures);
    // once per 24 hours, promote to a full pass to catch drift. Fire in
    // background so the cron response returns promptly.
    const integrations = await db
      .select({
        coachProfileId: coachCalendarIntegrations.coachProfileId,
        lastFullReconcileAt: coachCalendarIntegrations.lastFullReconcileAt,
      })
      .from(coachCalendarIntegrations)
      .where(eq(coachCalendarIntegrations.status, "active"));
    const nowMs = now.getTime();
    let fullPasses = 0;
    let lightPasses = 0;
    for (const row of integrations) {
      const needsFullPass =
        !row.lastFullReconcileAt ||
        nowMs - row.lastFullReconcileAt.getTime() > FULL_PASS_INTERVAL_MS;
      if (needsFullPass) {
        fullPasses++;
        queueMicrotask(() => { void runFullSyncPass(row.coachProfileId); });
      } else {
        lightPasses++;
        queueMicrotask(() => { void runLightSyncPass(row.coachProfileId); });
      }
    }

    req.log.info(
      { expiredCount: expired.length, completedCount: completed.length, fullPasses, lightPasses },
      "cron/tick",
    );

    res.json({
      expired: expired.length,
      completed: completed.length,
      fullPasses,
      lightPasses,
    });
  }),
);
