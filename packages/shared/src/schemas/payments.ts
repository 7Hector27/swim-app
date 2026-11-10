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

const CheckoutSessionTopupBodySchema = z.object({
  kind: z.literal("topup"),
  lessonTopup: z.object({
    durationMinutes: LessonDurationMinutesSchema,
    swimmerCount: SwimmerCountSchema,
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
