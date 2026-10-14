import { Router } from "express";
import { timingSafeEqual } from "crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "../db/client";
import { lessons } from "../db/schema";
import { validate } from "../middleware/validate";
import { asyncHandler } from "../middleware/asyncHandler";
import { chargeLessonComplete } from "../lib/lessonApproval";
import type { RequestHandler } from "express";

export const internalRouter = Router();

// Middleware: validate CRON_SECRET header using constant-time comparison to
// prevent timing-based secret enumeration attacks.
const requireCronSecret: RequestHandler = (req, res, next) => {
  const secret = process.env["CRON_SECRET"];
  const provided = req.headers["cron-secret"];
  if (
    !secret ||
    typeof provided !== "string" ||
    provided.length !== secret.length ||
    !timingSafeEqual(Buffer.from(provided), Buffer.from(secret))
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

    req.log.info({ expiredCount: expired.length, completedCount: completed.length }, "cron/tick");

    res.json({ expired: expired.length, completed: completed.length });
  }),
);
