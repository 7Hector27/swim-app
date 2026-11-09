// Stripe Checkout session metadata (ADR 036 Phase 3).
//
// Every amount this app credits comes from a webhook, and every webhook is
// re-validated against the pricing module before we move a cent. Stripe's
// session.metadata is a flat string→string map (SDK-enforced limit of 50
// keys, 500 chars per value), so pricing inputs go in as plain strings and
// this schema both parses them back into typed values and refuses anything
// shaped wrong.
//
// The metadata is set by the API at Checkout session creation time, so by
// construction it's always well-formed when we see it on the webhook — any
// failure here signals tampering, a bad test fixture, or a bug.

import { z } from "zod";

import { LESSON_DURATION_MINUTES, PackageTierSchema, SwimmerCountSchema } from "@swim-app/shared";

// Stripe stores metadata values as strings; coerce back to numbers.
const SwimmerCountStringSchema = z.preprocess(
  (value) => (typeof value === "string" ? Number.parseInt(value, 10) : value),
  SwimmerCountSchema,
);

const LessonDurationStringSchema = z.preprocess(
  (value) => (typeof value === "string" ? Number.parseInt(value, 10) : value),
  z.union(
    LESSON_DURATION_MINUTES.map((minutes) => z.literal(minutes)) as unknown as [
      z.ZodLiteral<30>,
      z.ZodLiteral<45>,
      z.ZodLiteral<60>,
    ],
  ),
);

const TopupMetadataSchema = z.object({
  kind: z.literal("topup"),
  householdId: z.string().uuid(),
  actorId: z.string().uuid(),
  durationMinutes: LessonDurationStringSchema,
  swimmerCount: SwimmerCountStringSchema,
});

const PackageMetadataSchema = z.object({
  kind: z.literal("package"),
  householdId: z.string().uuid(),
  actorId: z.string().uuid(),
  packageTier: PackageTierSchema,
  swimmerCount: SwimmerCountStringSchema,
});

export const CheckoutMetadataSchema = z.discriminatedUnion("kind", [
  TopupMetadataSchema,
  PackageMetadataSchema,
]);

export type CheckoutMetadata = z.infer<typeof CheckoutMetadataSchema>;
