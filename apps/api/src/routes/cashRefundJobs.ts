// Coach-side cash-refund-job resolution (ADR 036 Phase 8 Part B Stop 2).
//
// POST /coach/cash-refund-jobs/:jobId/mark-refunded — Jason types a note
// after settling a needs_manual_handling job off platform (e.g. via the
// Stripe dashboard for a payment older than 180 days, or Venmo for a
// card that no longer exists). The job row moves to status='succeeded'
// without any further Stripe call; the audit trail stores the note and
// the resolver's id.

import { Router } from "express";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import {
  MarkCashRefundHandledBodySchema,
  MarkCashRefundHandledResponseSchema,
  type MarkCashRefundHandledBody,
  type MarkCashRefundHandledResponse,
} from "@swim-app/shared";

import { db } from "../db/client";
import { cashRefundJobs, coachAuditLog, coachNotifications } from "../db/schema";
import { asyncHandler } from "../middleware/asyncHandler";
import { validate } from "../middleware/validate";

export const cashRefundJobsRouter = Router();

const JobIdParamsSchema = z.object({ jobId: z.string().uuid() });
type JobIdParams = z.infer<typeof JobIdParamsSchema>;

cashRefundJobsRouter.post(
  "/cash-refund-jobs/:jobId/mark-refunded",
  validate({ params: JobIdParamsSchema, body: MarkCashRefundHandledBodySchema }),
  asyncHandler(async (req, res) => {
    const { jobId } = req.params as unknown as JobIdParams;
    const body = req.body as MarkCashRefundHandledBody;
    const actorId = req.profile.id;

    const result = await db.transaction(async (tx) => {
      // SELECT ... FOR UPDATE on the job row so two concurrent clicks
      // on "Mark as refunded" (double submit, two tabs) serialize and
      // the second one sees the already-succeeded state.
      const rows = await tx
        .select({
          id: cashRefundJobs.id,
          status: cashRefundJobs.status,
          ledgerId: cashRefundJobs.ledgerId,
          amountCents: cashRefundJobs.amountCents,
        })
        .from(cashRefundJobs)
        .where(eq(cashRefundJobs.id, jobId))
        .for("update")
        .limit(1);
      const row = rows[0];
      if (!row) {
        return { kind: "not_found" as const };
      }
      if (row.status !== "needs_manual_handling") {
        return { kind: "invalid_state" as const };
      }

      await tx
        .update(cashRefundJobs)
        .set({
          status: "succeeded",
          succeededAt: sql`now()`,
          resolutionNote: body.note.trim(),
          resolvedBy: actorId,
        })
        .where(eq(cashRefundJobs.id, jobId));

      await tx.insert(coachAuditLog).values({
        coachId: actorId,
        actorId,
        action: "cash_refund_marked_handled",
        payload: {
          jobId,
          ledgerId: row.ledgerId,
          amountCents: row.amountCents,
          note: body.note.trim(),
        },
      });

      // Drop the paired bell row in the same transaction so Jason's
      // notification list clears the moment he resolves the job.
      // Idempotent: zero rows affected is fine (the notification may
      // already have been dismissed or the row may never have been
      // written because no active coach profile existed at enqueue
      // time).
      await tx
        .delete(coachNotifications)
        .where(eq(coachNotifications.tag, `cash-refund-needs-manual:${jobId}`));

      return { kind: "ok" as const };
    });

    if (result.kind === "not_found") {
      res.status(404).json({ error: "cash_refund_job_not_found" });
      return;
    }
    if (result.kind === "invalid_state") {
      res.status(422).json({ error: "invalid_state" });
      return;
    }

    const response: MarkCashRefundHandledResponse = {
      jobId,
      status: "succeeded",
    };
    res.status(200).json(MarkCashRefundHandledResponseSchema.parse(response));
  }),
);
