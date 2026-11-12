// Coach notifications tied to the cash-refund drain (ADR 036 Phase 8
// Part B).
//
// When a cash-refund job lands in `status = 'needs_manual_handling'`
// (either on insert because the refundable residual couldn't be matched
// to a live card payment, or after the drain exhausts its retries), we
// insert a `coach_notifications` row so the family-detail banner — and
// the bell — surface the "Jason needs to refund this off platform"
// signal immediately.
//
// The helper runs inside the caller's transaction so the notification
// lands with the UPDATE/INSERT that transitioned the job (CLAUDE.md
// audit-log rule). The payload carries `stripePaymentIntentId` (or null
// for direct-needs-manual with no matched payment) so Jason can copy-
// paste it into the Stripe dashboard — we no longer snapshot the family
// name anywhere: after deletion a family's name must not survive on our
// side.

import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "../../db/schema";
import { coachNotifications } from "../../db/schema";
import { getActiveCoachProfile } from "../../lib/coachProfile";

type Tx = PostgresJsDatabase<typeof schema>;

/**
 * Map an opaque `cash_refund_jobs.needs_manual_reason` to a short,
 * human-safe string the coach banner can render. Shared with the
 * `GET /coach/households/:id/needs-manual-refund` endpoint so the
 * banner payload and the live-queried list agree on wording.
 *
 * Pure function — no DB access — so it is cheap to call everywhere
 * (notification insert, GET route, tests).
 */
export function reasonForBanner(raw: string | null): string {
  if (raw === null) return "Pending review";
  if (raw === "no_refundable_card_payment") return "No matching card payment";
  if (raw.startsWith("stripe_refund_failed:")) return "Stripe refund failed";
  return "Pending review";
}

export interface EnqueueCashRefundNeedsManualArgs {
  jobId: string;
  // Non-null unless the household has already been anonymized (future-
  // proofing: today the deletion path writes the job BEFORE anonymizing
  // so the id is still live at helper-call time).
  householdId: string | null;
  // Positive cents — the amount Jason needs to refund off platform.
  amountCents: number;
  // Raw `needs_manual_reason` string stored on the job row. Mapped to
  // a human-safe label via `reasonForBanner` for the payload.
  reason: string;
  // The Stripe payment intent id attached to the job (null when the
  // residual couldn't be matched to any live card payment — the direct-
  // needs-manual path). Lets Jason paste the id into the Stripe
  // dashboard without needing a family name on file.
  stripePaymentIntentId: string | null;
  siteUrl: string;
}

/**
 * Insert one `coach_notifications` row keyed to a needs-manual-handling
 * cash-refund job. Returns the inserted notification id so callers can
 * assert in tests; the row is otherwise a fire-and-forget bell entry.
 *
 * Returns null when no active coach profile exists (the app is in a
 * bare / seeded state) so the helper is safe to call unconditionally
 * from the service — the deletion engine does the same for its
 * account-deleted summary.
 */
export async function enqueueCashRefundNeedsManualNotification(
  tx: Tx,
  args: EnqueueCashRefundNeedsManualArgs,
): Promise<string | null> {
  const coach = await getActiveCoachProfile();
  if (!coach) return null;

  const clickUrl = args.householdId !== null
    ? `${args.siteUrl}/coach/families/${args.householdId}`
    : `${args.siteUrl}/coach/families`;

  const inserted = await tx
    .insert(coachNotifications)
    .values({
      profileId: coach.id,
      category: "cash_refund_needs_manual_handling",
      urgency: "standard",
      payload: {
        // `listTitle` is the short in-app label the bell renders
        // (ADR 031). Every payload carries one so the list stays
        // pure/renderer-independent even if the push renderer grows.
        listTitle: "Refund needs your attention",
        kind: "cash_refund_needs_manual_handling",
        jobId: args.jobId,
        amountCents: args.amountCents,
        reason: reasonForBanner(args.reason),
        stripePaymentIntentId: args.stripePaymentIntentId,
      },
      clickUrl,
      tag: `cash-refund-needs-manual:${args.jobId}`,
    })
    .returning({ id: coachNotifications.id });
  return inserted[0]?.id ?? null;
}
