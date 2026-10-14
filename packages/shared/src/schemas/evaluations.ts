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
export const SkillRatingSchema = z.object({
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
});
export type SkillRating = z.infer<typeof SkillRatingSchema>;

export const RatingFaultTagSchema = z.object({
  ratingId: z.string().uuid(),
  faultTag: z.string(),
  createdAt: z.string().datetime({ offset: true }),
});
export type RatingFaultTag = z.infer<typeof RatingFaultTagSchema>;
