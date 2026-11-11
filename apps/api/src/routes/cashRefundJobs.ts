// Coach-side cash-refund-job resolution (ADR 036 Phase 8 Part B).
//
// POST /coach/cash-refund-jobs/:jobId/mark-refunded — Jason types a note
// after settling a needs_manual_handling job off platform (e.g. via the
// Stripe dashboard for a payment older than 180 days, or Venmo for a
// card that no longer exists). The job row moves to status='succeeded'
// without any further Stripe call; the audit trail stores the note and
// the resolver's id.
//
// GET /coach/cash-refunds/needs-attention — global list of every job
// still at status='needs_manual_handling', across live and deleted
// households. Powers the attention section at the top of /coach/families.

import { Router } from "express";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import {
  CashRefundNeedsAttentionResponseSchema,
  MarkCashRefundHandledBodySchema,
  MarkCashRefundHandledResponseSchema,
  type CashRefundNeedsAttentionEntry,
  type CashRefundNeedsAttentionResponse,
  type MarkCashRefundHandledBody,
  type MarkCashRefundHandledResponse,
} from "@swim-app/shared";

import { db } from "../db/client";
import {
  cashRefundJobs,
  coachAuditLog,
  coachNotifications,
  households,
} from "../db/schema";
import { asyncHandler } from "../middleware/asyncHandler";
import { validate } from "../middleware/validate";
import { reasonForBanner } from "../services/balance/notifications";

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

// ── GET /coach/cash-refunds/needs-attention ────────────────────────────────
//
// Global list of every cash_refund_jobs row still at needs_manual_handling,
// across live AND deleted households. The left join lets rows with
// household_id = NULL (anonymized by account deletion) still appear; the
// web renders those as "Deleted family" and uses the Stripe payment
// intent id as the identifier Jason copies into the Stripe dashboard.
//
// Newest-first so the most recently flagged refund is on top. No query
// params — the list is short by construction; pagination is only worth
// adding if it ever grows past a few dozen entries.
cashRefundJobsRouter.get(
  "/cash-refunds/needs-attention",
  validate({}),
  asyncHandler(async (_req, res) => {
    const rows = await db
      .select({
        jobId: cashRefundJobs.id,
        amountCents: cashRefundJobs.amountCents,
        needsManualReason: cashRefundJobs.needsManualReason,
        createdAt: cashRefundJobs.createdAt,
        stripePaymentIntentId: cashRefundJobs.stripePaymentIntentId,
        householdId: households.id,
        householdName: households.name,
      })
      .from(cashRefundJobs)
      .leftJoin(households, eq(cashRefundJobs.householdId, households.id))
      .where(eq(cashRefundJobs.status, "needs_manual_handling"))
      .orderBy(desc(cashRefundJobs.createdAt));

    const jobs: CashRefundNeedsAttentionEntry[] = rows.map((row) => ({
      jobId: row.jobId,
      amountCents: row.amountCents,
      reason: reasonForBanner(row.needsManualReason),
      createdAt: row.createdAt.toISOString(),
      stripePaymentIntentId: row.stripePaymentIntentId,
      household:
        row.householdId !== null && row.householdName !== null
          ? { id: row.householdId, name: row.householdName }
          : null,
    }));

    const response: CashRefundNeedsAttentionResponse = { jobs };
    res.status(200).json(CashRefundNeedsAttentionResponseSchema.parse(response));
  }),
);
