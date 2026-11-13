import { z } from "zod";

import { LessonDurationMinutesSchema } from "./booking";

// Swimmer count used by the pricing module and all payment flows. The value
// never comes from the browser directly on checkout bodies — the server reads
// it from the household row for lesson charges — but it does appear in topup
// and package bodies to pick which price tier applies.
export const SwimmerCountSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);
export type SwimmerCount = z.infer<typeof SwimmerCountSchema>;

export const PackageTierSchema = z.enum(["cannonball", "deep_end"]);
export type PackageTier = z.infer<typeof PackageTierSchema>;

// Mirrors the Postgres enum of the same name. The server writes the enum
// value; the client only reads it (via the ledger history endpoint).
export const BalanceEntryTypeSchema = z.enum([
  "card_topup",
  "package_purchase",
  "package_bonus",
  "lesson_charge",
  "refund_to_balance",
  "coach_adjustment",
  "free_lesson",
  // ADR 036 Phase 8 Part B — cash-out refund engine. `cash_refund` rows
  // record a Stripe refund issued back to the original card; `balance_
  // writeoff` rows absorb unused bonus / coach gifts that can't be
  // refunded off-platform. Both are negative amounts in the ledger.
  "cash_refund",
  "balance_writeoff",
]);
export type BalanceEntryType = z.infer<typeof BalanceEntryTypeSchema>;

// Shape of one household_balance_ledger row as returned to the balance history
// view. `householdId` is nullable to carry rows whose household has been
// anonymized by the account-deletion flow — the ledger row survives for tax
// retention, stripped of identifying columns.
export const LedgerEntrySchema = z.object({
  id: z.string().uuid(),
  householdId: z.string().uuid().nullable(),
  entryType: BalanceEntryTypeSchema,
  amountCents: z.number().int(),
  lessonId: z.string().uuid().nullable(),
  stripeCheckoutSessionId: z.string().nullable(),
  stripePaymentIntentId: z.string().nullable(),
  actorId: z.string().uuid().nullable(),
  reason: z.string().nullable(),
  createdAt: z.string().datetime({ offset: true }),
});
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;

// Response shape for GET /me/balance. Balance is the authoritative integer
// cents figure; approximatePrivateHours is a derived convenience computed by
// the server from the pricing module so the client never does the math.
export const BalanceResponseSchema = z.object({
  balanceCents: z.number().int(),
  approximatePrivateHours: z.number().nonnegative(),
});
export type BalanceResponse = z.infer<typeof BalanceResponseSchema>;

// Request body for POST /payments/checkout-session. The server computes every
// amount from the pricing module from these pricing inputs alone — the body
// carries no amount, no price, and no household id (that comes from the auth
// session). Both variants use .strict() so a body with an extra `amountCents`
// key (or any other unexpected field) is rejected rather than quietly ignored.
//
// `successReturnTo` is an optional relative path the server uses to build
// the Stripe success_url. Server validates it starts with "/" and contains
// no scheme/host — all browsers and Stripe land the parent back on our
// own domain. Defaults to "/account/balance" when omitted.
const SuccessReturnToSchema = z
  .string()
  .regex(/^\/[^/\\]/, "successReturnTo must be a relative path starting with '/'")
  .refine(
    (value) => !/^(https?:)?\/\//i.test(value) && !value.includes("\\"),
    { message: "successReturnTo must not include a scheme or host" },
  )
  .optional();

// ADR 036 Phase 8 Part B Stop 3 piece 8: single-lesson top-up now
// accepts a quantity (1..20). The API computes the total server-side
// as priceForLesson(duration, swimmerCount) * quantity; the webhook
// recomputes the same product from metadata before crediting the
// balance. 20 is a soft operational ceiling — a parent prepaying a
// season's worth of lessons without a package — and also the point
// where the Deep End package is obviously cheaper, so the UI nudges
// to a package well before this limit.
export const LESSON_TOPUP_MIN_QUANTITY = 1;
export const LESSON_TOPUP_MAX_QUANTITY = 20;

const CheckoutSessionTopupBodySchema = z.object({
  kind: z.literal("topup"),
  lessonTopup: z.object({
    durationMinutes: LessonDurationMinutesSchema,
    swimmerCount: SwimmerCountSchema,
    quantity: z
      .number()
      .int()
      .min(LESSON_TOPUP_MIN_QUANTITY)
      .max(LESSON_TOPUP_MAX_QUANTITY),
  }).strict(),
  successReturnTo: SuccessReturnToSchema,
}).strict();

const CheckoutSessionPackageBodySchema = z.object({
  kind: z.literal("package"),
  packageTier: PackageTierSchema,
  swimmerCount: SwimmerCountSchema,
  successReturnTo: SuccessReturnToSchema,
}).strict();

export const CheckoutSessionBodySchema = z.discriminatedUnion("kind", [
  CheckoutSessionTopupBodySchema,
  CheckoutSessionPackageBodySchema,
]);
export type CheckoutSessionBody = z.infer<typeof CheckoutSessionBodySchema>;

// Response body — the API returns the hosted Stripe URL; the web app redirects
// to it. The session id is returned purely so the client can log it alongside
// an abandonment event if the parent bails out mid-redirect.
export const CheckoutSessionResponseSchema = z.object({
  url: z.string().url(),
  sessionId: z.string(),
});
export type CheckoutSessionResponse = z.infer<typeof CheckoutSessionResponseSchema>;

// GET /me/balance/history — reverse-chronological ledger entries for the
// caller's household, with plain-language `displayType` and the running
// balance after each entry so the client renders a one-row-one-number
// table without re-summing. Paginated at 50 rows via `nextCursor`
// (opaque — the server reads it back to pick up where the last page left
// off; the client treats it as a forward token).
export const BalanceHistoryEntrySchema = z.object({
  id: z.string().uuid(),
  entryType: BalanceEntryTypeSchema,
  amountCents: z.number().int(),
  runningBalanceCents: z.number().int(),
  createdAt: z.string().datetime({ offset: true }),
  // Plain-language short label — server-rendered so the client doesn't
  // have to reproduce the "Package: Cannonball (2 swimmers)" / "Jason
  // adjusted" phrasing from ledger fields.
  displayType: z.string(),
});
export type BalanceHistoryEntry = z.infer<typeof BalanceHistoryEntrySchema>;

export const BalanceHistoryResponseSchema = z.object({
  entries: z.array(BalanceHistoryEntrySchema),
  nextCursor: z.string().nullable(),
});
export type BalanceHistoryResponse = z.infer<typeof BalanceHistoryResponseSchema>;

export const BalanceHistoryQuerySchema = z.object({
  cursor: z.string().optional(),
});
export type BalanceHistoryQuery = z.infer<typeof BalanceHistoryQuerySchema>;

// ── Coach-side household-balance views (ADR 036 Phase 6) ─────────────────
//
// GET /coach/households/balances — one row per household with the fields
// Jason needs to glance at the full roster: name, who's in it, how many
// active swimmers, current balance, and when the last ledger move
// happened (so a long-silent family is visibly different from an
// active one). Client sorts; server returns a stable name-alphabetical
// order so consecutive renders don't jitter.
export const CoachHouseholdBalanceSummarySchema = z.object({
  householdId: z.string().uuid(),
  householdName: z.string(),
  memberFullNames: z.array(z.string()),
  activeSwimmerCount: z.number().int().nonnegative(),
  balanceCents: z.number().int(),
  // Null when the household has no ledger rows at all — the client renders
  // "—" rather than guessing an epoch date.
  lastActivityAt: z.string().datetime({ offset: true }).nullable(),
});
export type CoachHouseholdBalanceSummary = z.infer<
  typeof CoachHouseholdBalanceSummarySchema
>;

export const CoachHouseholdBalanceListResponseSchema = z.array(
  CoachHouseholdBalanceSummarySchema,
);
export type CoachHouseholdBalanceListResponse = z.infer<
  typeof CoachHouseholdBalanceListResponseSchema
>;

// POST /coach/households/:householdId/balance/adjust — manual coach
// adjustment. amountCents may be positive or negative but must not be
// zero (a no-op has no ledger row). Reason is required on every call
// so the "Jason adjusted · <reason>" display line in parent history
// is never blank. A negative adjustment that would drop the balance
// below zero is rejected server-side with 422 insufficient_balance.
export const CoachAdjustBalanceBodySchema = z
  .object({
    amountCents: z
      .number()
      .int()
      .refine((value) => value !== 0, "amountCents must be non-zero"),
    reason: z
      .string()
      .trim()
      .min(1, "reason is required")
      .max(500, "reason must be 500 characters or fewer"),
  })
  .strict();
export type CoachAdjustBalanceBody = z.infer<typeof CoachAdjustBalanceBodySchema>;

export const CoachAdjustBalanceResponseSchema = z.object({
  balanceCents: z.number().int(),
  ledgerId: z.string().uuid(),
});
export type CoachAdjustBalanceResponse = z.infer<
  typeof CoachAdjustBalanceResponseSchema
>;

// ── Cash-out (ADR 036 Phase 8 Part B) ───────────────────────────────────

// Breakdown of a cash-out: paid, used, refunded, written off. Matches
// the plain-language policy surfaces. All fields non-negative integer
// cents; see docs/plans/payments.md §8 for the refund-rule derivation.
export const CashOutBreakdownSchema = z.object({
  totalCardPaidCents: z.number().int().nonnegative(),
  totalCashRefundedCents: z.number().int().nonnegative(),
  netLessonSpendingCents: z.number().int().nonnegative(),
  currentBalanceCents: z.number().int().nonnegative(),
  refundableCents: z.number().int().nonnegative(),
  writeOffCents: z.number().int().nonnegative(),
});
export type CashOutBreakdown = z.infer<typeof CashOutBreakdownSchema>;

// What the service returns after writing the ledger rows + jobs. The
// `needsManualHandlingCents` field is the residual that could not be
// allocated to any payment (e.g. all card payments are older than
// Stripe's 180-day window) — surfaced to the caller so Jason sees it.
export const CashOutResponseSchema = z.object({
  breakdown: CashOutBreakdownSchema,
  refundJobCount: z.number().int().nonnegative(),
  needsManualHandlingCents: z.number().int().nonnegative(),
});
export type CashOutResponse = z.infer<typeof CashOutResponseSchema>;

// Needs-manual-handling cash-refund job as surfaced to the coach banner
// on a family page (ADR 036 Phase 8 Part B Stop 2). The amount is
// positive cents; the family is owed this amount back and Jason must
// refund it off platform (e.g. via the Stripe dashboard for a payment
// older than 180 days, or Venmo for one that no longer exists).
export const NeedsManualRefundJobSchema = z.object({
  id: z.string().uuid(),
  amountCents: z.number().int().positive(),
  reason: z.string(),
  createdAt: z.string().datetime({ offset: true }),
});
export type NeedsManualRefundJob = z.infer<typeof NeedsManualRefundJobSchema>;

export const NeedsManualRefundListResponseSchema = z.object({
  jobs: z.array(NeedsManualRefundJobSchema),
});
export type NeedsManualRefundListResponse = z.infer<typeof NeedsManualRefundListResponseSchema>;

// Request body for the coach "Mark as refunded" action — Jason types a
// note describing how he settled the refund off-platform.
export const MarkCashRefundHandledBodySchema = z.object({
  note: z.string().trim().min(1, "note is required").max(500, "note must be 500 characters or fewer"),
}).strict();
export type MarkCashRefundHandledBody = z.infer<typeof MarkCashRefundHandledBodySchema>;

export const MarkCashRefundHandledResponseSchema = z.object({
  jobId: z.string().uuid(),
  status: z.literal("succeeded"),
});
export type MarkCashRefundHandledResponse = z.infer<typeof MarkCashRefundHandledResponseSchema>;

// Entry in the global "Refunds needing attention" list shown at the top
// of /coach/families (ADR 036 Phase 8 Part B). Lives across household
// deletion: a deleted family renders as "Deleted family" and is
// identified by the Stripe payment intent id (or lack thereof). The
// "Mark as refunded" button on each entry hits the same cash-refund-
// jobs/:id/mark-refunded endpoint as the per-family banner.
export const CashRefundNeedsAttentionEntrySchema = z.object({
  jobId: z.string().uuid(),
  amountCents: z.number().int().positive(),
  reason: z.string(),
  createdAt: z.string().datetime({ offset: true }),
  stripePaymentIntentId: z.string().nullable(),
  // Null when the household has been anonymized (account deletion ran).
  // The web renders this as "Deleted family" and omits the family-page
  // link — the entry is still actionable via Mark as refunded.
  household: z
    .object({ id: z.string().uuid(), name: z.string() })
    .nullable(),
});
export type CashRefundNeedsAttentionEntry = z.infer<
  typeof CashRefundNeedsAttentionEntrySchema
>;

export const CashRefundNeedsAttentionResponseSchema = z.object({
  jobs: z.array(CashRefundNeedsAttentionEntrySchema),
});
export type CashRefundNeedsAttentionResponse = z.infer<
  typeof CashRefundNeedsAttentionResponseSchema
>;

