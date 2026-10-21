import { Router } from "express";
import { createHash, timingSafeEqual } from "crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "../db/client";
import { lessons } from "../db/schema";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../middleware/asyncHandler";
import { getEnv } from "../lib/env";
import { chargeLessonComplete } from "../lib/lessonApproval";
import { syncLessonToGoogle } from "../services/googleCalendarSync";
import type { RequestHandler } from "express";

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
    // circuits). Completed lessons DO have events and the service removes
    // them so the coach's Google state matches the plan's "approved and
    // upcoming → event; else → delete" rule. Microtasks run after the
    // response, independent of the HTTP request lifecycle.
    for (const row of expired) {
      queueMicrotask(() => { void syncLessonToGoogle(row.id); });
    }
    for (const row of completed) {
      queueMicrotask(() => { void syncLessonToGoogle(row.id); });
    }

    req.log.info({ expiredCount: expired.length, completedCount: completed.length }, "cron/tick");

    res.json({ expired: expired.length, completed: completed.length });
  }),
);
