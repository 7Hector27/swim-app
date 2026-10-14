import { z } from "zod";

export const EvaluationContextSchema = z.enum(["drill", "practice", "race"]);
export type EvaluationContext = z.infer<typeof EvaluationContextSchema>;

export const RatingSideSchema = z.enum(["left", "right"]);
export type RatingSide = z.infer<typeof RatingSideSchema>;

export const CapacityUnitSchema = z.enum(["yards", "reps"]);
export type CapacityUnit = z.infer<typeof CapacityUnitSchema>;

export const MeasurementUnitSchema = z.enum([
  "stroke_cycles_per_minute",
  "stroke_count",
  "seconds",
  "feet",
]);
export type MeasurementUnit = z.infer<typeof MeasurementUnitSchema>;

export const EvaluationSessionSchema = z.object({
  id: z.string().uuid(),
  swimmerId: z.string().uuid(),
  coachId: z.string().uuid(),
  categoryId: z.string().uuid(),
  sessionDate: z.string().date(),
  context: EvaluationContextSchema,
  coachingPriority: z.string().min(1),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type EvaluationSession = z.infer<typeof EvaluationSessionSchema>;

// Numeric columns are returned as strings by Drizzle (preserves precision).
export const SkillRatingSchema = z
  .object({
    id: z.string().uuid(),
    sessionId: z.string().uuid(),
    swimmerId: z.string().uuid(),
    skillId: z.string().uuid(),
    coachId: z.string().uuid(),
    grade: z.number().int().min(1).max(5).nullable(),
    notLegal: z.boolean(),
    noConcept: z.boolean(),
    side: RatingSideSchema.nullable(),
    capacityValue: z.string().nullable(),
    capacityUnit: CapacityUnitSchema.nullable(),
    measurementValue: z.string().nullable(),
    measurementUnit: MeasurementUnitSchema.nullable(),
    note: z.string().nullable(),
    voidedAt: z.string().datetime({ offset: true }).nullable(),
    voidReason: z.string().nullable(),
    voidBy: z.string().uuid().nullable(),
    ratedAt: z.string().datetime({ offset: true }),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .superRefine((val, ctx) => {
    // grade XOR no_concept: grade 1–5 with no_concept=false, or no grade with no_concept=true.
    const gradeValid =
      !val.noConcept && val.grade !== null ||
      val.noConcept && val.grade === null;
    if (!gradeValid) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "grade must be 1–5 when noConcept is false; grade must be null when noConcept is true",
        path: ["grade"],
      });
    }
    // not_legal requires a phantom grade.
    if (val.notLegal && val.grade === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "notLegal requires a non-null grade",
        path: ["notLegal"],
      });
    }
    // Void fields are all set or all null.
    const voidFields = [val.voidedAt, val.voidReason, val.voidBy];
    const voidCount = voidFields.filter((v) => v !== null).length;
    if (voidCount !== 0 && voidCount !== 3) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "voidedAt, voidReason, and voidBy must all be set or all be null",
        path: ["voidedAt"],
      });
    }
  });
export type SkillRating = z.infer<typeof SkillRatingSchema>;

export const RatingFaultTagSchema = z.object({
  ratingId: z.string().uuid(),
  faultTag: z.string().min(1),
  createdAt: z.string().datetime({ offset: true }),
});
export type RatingFaultTag = z.infer<typeof RatingFaultTagSchema>;

// ── Request / response schemas for E-3 routes ────────────────────────────────

const RatingInputSchema = z
  .object({
    skillId: z.string().uuid(),
    grade: z.number().int().min(1).max(5).nullable(),
    notLegal: z.boolean(),
    noConcept: z.boolean(),
    side: RatingSideSchema.nullable(),
    capacityValue: z.string().nullable(),
    capacityUnit: CapacityUnitSchema.nullable(),
    measurementValue: z.string().nullable(),
    measurementUnit: MeasurementUnitSchema.nullable(),
    note: z.string().nullable(),
    faultTags: z.array(z.string()),
    ratedAt: z.string().datetime({ offset: true }),
  })
  .superRefine((val, ctx) => {
    const gradeValid =
      (!val.noConcept && val.grade !== null) ||
      (val.noConcept && val.grade === null);
    if (!gradeValid) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "grade must be 1–5 when noConcept is false; grade must be null when noConcept is true",
        path: ["grade"],
      });
    }
    if (val.notLegal && val.grade === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "notLegal requires a non-null grade",
        path: ["notLegal"],
      });
    }
    if (
      (val.capacityValue === null) !== (val.capacityUnit === null)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "capacityValue and capacityUnit must both be present or both be absent",
        path: ["capacityValue"],
      });
    }
    if (
      (val.measurementValue === null) !== (val.measurementUnit === null)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "measurementValue and measurementUnit must both be present or both be absent",
        path: ["measurementValue"],
      });
    }
  });
export type RatingInput = z.infer<typeof RatingInputSchema>;

export const CreateSessionBodySchema = z.object({
  categoryId: z.string().uuid(),
  sessionDate: z.string().date(),
  context: EvaluationContextSchema,
  coachingPriority: z.string().min(1),
  ratings: z.array(RatingInputSchema).min(1),
});
export type CreateSessionBody = z.infer<typeof CreateSessionBodySchema>;

export const CreateSessionResponseSchema = z.object({
  sessionId: z.string().uuid(),
  ratingsCount: z.number().int(),
});
export type CreateSessionResponse = z.infer<typeof CreateSessionResponseSchema>;

export const VoidRatingBodySchema = z.object({
  reason: z.string().min(1),
});
export type VoidRatingBody = z.infer<typeof VoidRatingBodySchema>;

export const DependencyMapQuerySchema = z.object({
  categoryId: z.string().uuid(),
});
export type DependencyMapQuery = z.infer<typeof DependencyMapQuerySchema>;
