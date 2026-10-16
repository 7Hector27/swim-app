import { z } from "zod";
import { StartGradeResultSchema } from "../lib/startGrade";
import { StrokeSchema } from "./skills";

export const EvaluationContextSchema = z.enum(["drill", "practice", "race"]);
export type EvaluationContext = z.infer<typeof EvaluationContextSchema>;

export const BreathingPatternSchema = z.enum(["every_1","every_2","every_3","every_4","every_5","other"]);
export type BreathingPattern = z.infer<typeof BreathingPatternSchema>;

export const GolfScoreCategorySchema = z.enum(["push_off_in_water", "deck_dive", "block_dive"]);
export type GolfScoreCategory = z.infer<typeof GolfScoreCategorySchema>;

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

// Base schema: fields safe for any authenticated caller.
export const SkillRatingBaseSchema = z.object({
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
  voidedAt: z.string().datetime({ offset: true }).nullable(),
  ratedAt: z.string().datetime({ offset: true }),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

// Coach-only fields added on top.
export const CoachSkillRatingSchema = SkillRatingBaseSchema.extend({
  note: z.string().nullable(),
  voidReason: z.string().nullable(),
  voidBy: z.string().uuid().nullable(),
}).superRefine((val, ctx) => {
  // grade XOR no_concept: grade 1–5 with no_concept=false, or no grade with no_concept=true.
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
  const voidCount = voidFields.filter((voidField) => voidField !== null).length;
  if (voidCount !== 0 && voidCount !== 3) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "voidedAt, voidReason, and voidBy must all be set or all be null",
      path: ["voidedAt"],
    });
  }
});
export type CoachSkillRating = z.infer<typeof CoachSkillRatingSchema>;

// Parent-facing: omits coach notes and void details.
export const ParentSkillRatingSchema = SkillRatingBaseSchema;
export type ParentSkillRating = z.infer<typeof ParentSkillRatingSchema>;

// Backwards-compatible alias — CoachSkillRatingSchema is the full shape.
export const SkillRatingSchema = CoachSkillRatingSchema;
export type SkillRating = CoachSkillRating;

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
    golfScoreCategory: GolfScoreCategorySchema.nullable().optional().default(null),
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
  screenSlug: z.string(),
  sessionDate: z.string().date(),
  context: EvaluationContextSchema,
  coachingPriority: z.string().min(1),
  breathingPattern: BreathingPatternSchema.nullable(),
  ratings: z.array(RatingInputSchema).min(1),
});
export type CreateSessionBody = z.infer<typeof CreateSessionBodySchema>;

export const CreateSessionResponseSchema = z.object({
  sessionId: z.string().uuid(),
  ratingsCount: z.number().int(),
  ratingIds: z.array(z.string().uuid()),
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

export const SkillForRatingSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  type: z.enum(["rubric", "measured", "score", "composite", "rollup"]),
  unit: z.string().nullable(),
  stroke: StrokeSchema.nullable(),
  ratedPerSide: z.boolean(),
  notLegalAllowed: z.boolean(),
  parentSkillId: z.string().uuid().nullable(),
  sortOrder: z.number().int(),
  faultTags: z.array(z.string()),
  descriptors: z.array(z.object({ level: z.number().int().min(1).max(5), text: z.string() })),
});
export type SkillForRating = z.infer<typeof SkillForRatingSchema>;

export const SkillCategoryWithSkillsSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  sortOrder: z.number().int(),
  skills: z.array(SkillForRatingSchema),
});
export type SkillCategoryWithSkills = z.infer<typeof SkillCategoryWithSkillsSchema>;

export const CategoriesResponseSchema = z.array(SkillCategoryWithSkillsSchema);
export type CategoriesResponse = z.infer<typeof CategoriesResponseSchema>;

// ── Screen-based response (replaces /categories for the evaluation form) ───────

export const ScreenWithSkillsSchema = z.object({
  screenSlug: z.string(),
  name: z.string(),
  skills: z.array(SkillForRatingSchema),
});
export type ScreenWithSkills = z.infer<typeof ScreenWithSkillsSchema>;

export const ScreensResponseSchema = z.array(ScreenWithSkillsSchema);
export type ScreensResponse = z.infer<typeof ScreensResponseSchema>;

export const SwimmerSkillsResponseSchema = z.object({
  grades: z.record(
    z.union([z.number().int().min(1).max(5), z.literal("not_legal"), z.literal("no_concept")]),
  ),
  startGrades: z.record(StartGradeResultSchema),
  coachingPriorities: z.array(
    z.object({
      targetSlug: z.string(),
      chain: z.array(z.object({ slug: z.string(), grade: z.unknown(), sortOrder: z.number().int() })),
    }),
  ),
});
export type SwimmerSkillsResponse = z.infer<typeof SwimmerSkillsResponseSchema>;

// ── E-5 Progress schemas ──────────────────────────────────────────────────────

export const SkillCurrentLevelSchema = z.object({
  grade: z.number().int().min(1).max(5).nullable(),
  notLegal: z.boolean(),
  noConcept: z.boolean(),
  capacityValue: z.string().nullable(),
  capacityUnit: CapacityUnitSchema.nullable(),
  measurementValue: z.string().nullable(),
  measurementUnit: MeasurementUnitSchema.nullable(),
});
export type SkillCurrentLevel = z.infer<typeof SkillCurrentLevelSchema>;

export const ProgressRatingPointSchema = z.object({
  id: z.string().uuid(),
  grade: z.number().int().min(1).max(5).nullable(),
  notLegal: z.boolean(),
  noConcept: z.boolean(),
  side: RatingSideSchema.nullable(),
  capacityValue: z.string().nullable(),
  capacityUnit: CapacityUnitSchema.nullable(),
  measurementValue: z.string().nullable(),
  measurementUnit: MeasurementUnitSchema.nullable(),
  context: EvaluationContextSchema,
  faultTags: z.array(z.string()),
  ratedAt: z.string().datetime({ offset: true }),
  sessionDate: z.string().date(),
});
export type ProgressRatingPoint = z.infer<typeof ProgressRatingPointSchema>;

export const SkillProgressSchema = z.object({
  skillId: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  categoryId: z.string().uuid(),
  categoryName: z.string(),
  type: z.enum(["rubric", "measured", "score", "composite", "rollup"]),
  unit: z.string().nullable(),
  ratedPerSide: z.boolean(),
  parentSkillId: z.string().uuid().nullable(),
  current: SkillCurrentLevelSchema.nullable(),
  currentLeft: SkillCurrentLevelSchema.nullable(),
  currentRight: SkillCurrentLevelSchema.nullable(),
  history: z.array(ProgressRatingPointSchema),
});
export type SkillProgress = z.infer<typeof SkillProgressSchema>;

export const ProgressChainEntrySchema = z.object({
  slug: z.string(),
  name: z.string(),
  notAssessed: z.boolean(),
});
export type ProgressChainEntry = z.infer<typeof ProgressChainEntrySchema>;

export const ProgressCoachingPrioritySchema = z.object({
  targetSlug: z.string(),
  targetName: z.string(),
  chain: z.array(ProgressChainEntrySchema),
});
export type ProgressCoachingPriority = z.infer<typeof ProgressCoachingPrioritySchema>;

export const StartComponentProgressSchema = z.object({
  slug: z.string(),
  name: z.string(),
  current: SkillCurrentLevelSchema.nullable(),
});
export type StartComponentProgress = z.infer<typeof StartComponentProgressSchema>;

export const StartProgressSchema = z.object({
  slug: z.string(),
  name: z.string(),
  grade: StartGradeResultSchema,
  components: z.array(StartComponentProgressSchema),
});
export type StartProgress = z.infer<typeof StartProgressSchema>;

export const SwimmerProgressResponseSchema = z.object({
  skills: z.array(SkillProgressSchema),
  startProgress: z.array(StartProgressSchema),
  headPositionOverall: z.number().int().min(1).max(5).nullable(),
  coachingPriorities: z.array(ProgressCoachingPrioritySchema),
});
export type SwimmerProgressResponse = z.infer<typeof SwimmerProgressResponseSchema>;

// ── Draft schemas ─────────────────────────────────────────────────────────────

export const DraftSkillPayloadSchema = z.object({
  grade: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).nullable(),
  notLegal: z.boolean(),
  noConcept: z.boolean(),
  side: z.enum(["left", "right"]).nullable().optional(),
  faultTags: z.array(z.string()),
  capacityValue: z.string(),
  capacityUnit: z.enum(["yards", "reps"]).nullable(),
  measurementValue: z.string(),
  measurementUnit: z.string().nullable(),
  golfScoreCategory: GolfScoreCategorySchema.nullable(),
  note: z.string(),
});
export type DraftSkillPayload = z.infer<typeof DraftSkillPayloadSchema>;

export const SaveDraftBodySchema = z.object({
  sessionDate: z.string().nullable(),
  context: z.enum(["drill", "practice", "race"]).nullable(),
  coachingPriority: z.string().nullable(),
  breathingPattern: BreathingPatternSchema.nullable(),
  payload: z.record(z.string(), DraftSkillPayloadSchema),
});
export type SaveDraftBody = z.infer<typeof SaveDraftBodySchema>;

export const EvaluationDraftSchema = z.object({
  id: z.string().uuid(),
  swimmerId: z.string().uuid(),
  coachId: z.string().uuid(),
  screenSlug: z.string(),
  sessionDate: z.string().nullable(),
  context: z.enum(["drill", "practice", "race"]).nullable(),
  coachingPriority: z.string().nullable(),
  breathingPattern: BreathingPatternSchema.nullable(),
  payload: z.record(z.string(), DraftSkillPayloadSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EvaluationDraft = z.infer<typeof EvaluationDraftSchema>;

export const DraftsListResponseSchema = z.object({
  drafts: z.array(EvaluationDraftSchema),
});
export type DraftsListResponse = z.infer<typeof DraftsListResponseSchema>;

// ── Golf score trends schemas ──────────────────────────────────────────────

export const GolfScoreTrendPointSchema = z.object({
  ratedAt: z.string().datetime({ offset: true }),
  sessionDate: z.string().date(),
  grade: z.number().int().min(1).max(5).nullable(),
  measurementValue: z.string().nullable(),
});
export type GolfScoreTrendPoint = z.infer<typeof GolfScoreTrendPointSchema>;

export const GolfScoreAgeBandsSchema = z.object({
  bandCount: z.number().int(),
  p25: z.number().nullable(),
  p50: z.number().nullable(),
  p75: z.number().nullable(),
});
export type GolfScoreAgeBands = z.infer<typeof GolfScoreAgeBandsSchema>;

export const GolfScoreCategoryTrendSchema = z.object({
  category: GolfScoreCategorySchema,
  points: z.array(GolfScoreTrendPointSchema),
  ageBands: GolfScoreAgeBandsSchema.nullable(),
});
export type GolfScoreCategoryTrend = z.infer<typeof GolfScoreCategoryTrendSchema>;

export const GolfScoreTrendSchema = z.object({
  skillSlug: z.string(),
  skillName: z.string(),
  byCategory: z.array(GolfScoreCategoryTrendSchema),
});
export type GolfScoreTrend = z.infer<typeof GolfScoreTrendSchema>;

export const GolfScoreTrendsResponseSchema = z.object({
  trends: z.array(GolfScoreTrendSchema),
});
export type GolfScoreTrendsResponse = z.infer<typeof GolfScoreTrendsResponseSchema>;

// Parent-facing progress schemas — no fault tags
export const ParentProgressRatingPointSchema = ProgressRatingPointSchema.omit({ faultTags: true });
export type ParentProgressRatingPoint = z.infer<typeof ParentProgressRatingPointSchema>;

export const ParentSkillProgressSchema = SkillProgressSchema.extend({
  history: z.array(ParentProgressRatingPointSchema),
  levelDescriptors: z.record(z.string(), z.string()).optional(),
});
export type ParentSkillProgress = z.infer<typeof ParentSkillProgressSchema>;

export const ParentCoachingNoteSchema = z.object({
  screenSlug: z.string(),
  screenName: z.string(),
  text: z.string(),
  sessionDate: z.string(),
});
export type ParentCoachingNote = z.infer<typeof ParentCoachingNoteSchema>;

export const ParentSwimmerProgressResponseSchema = SwimmerProgressResponseSchema.extend({
  skills: z.array(ParentSkillProgressSchema),
  latestCoachingNotes: z.array(ParentCoachingNoteSchema),
});
export type ParentSwimmerProgressResponse = z.infer<typeof ParentSwimmerProgressResponseSchema>;
