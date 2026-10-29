import { z } from "zod";
import { SkillGradeSchema } from "../lib/dependencyMap";
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
  // Optional (nullable + optional). The parent-facing progress UI falls back to
  // the most recent non-empty priority from a non-voided session, so coaches
  // can leave this blank when there is nothing new to say.
  coachingPriority: z.string().min(1).nullable(),
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
  // Nullable (optional for the coach): empty is accepted. Whitespace-only
  // strings normalize to null at the API boundary.
  coachingPriority: z.string().min(1).nullable(),
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
  screenSlug: z.string(),
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

// ADR 032: `edited` is true when this history point is a correction leaf
// (supersedes_rating_id IS NOT NULL). `previousValue` is the pre-correction
// grade walked one hop back through supersedes_rating_id — SkillGrade covers
// 1..5 plus `not_legal` / `no_concept` so edits off a special state render
// correctly. Null on uncorrected points. `sessionId` is the session the point
// belongs to; the per-point Edit affordance deep-links through it.
export const ProgressRatingPointSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
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
  edited: z.boolean(),
  previousValue: SkillGradeSchema.nullable(),
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
  // ADR 032: lets the chart's selected-point "Edit this evaluation" link
  // deep-link into the Evaluate page in edit mode.
  sessionId: z.string().uuid(),
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

// ── Score history ─────────────────────────────────────────────────────────────
// Server-side computeAsOf: one point per non-voided session date, each carrying
// head-position overall (2.4), per-category rollups (2.5), and start-grade
// progression (2.7) computed from the ratings known as of that date.

export const ScoreHistoryCategoryRollupSchema = z.object({
  categoryId: z.string().uuid(),
  categorySlug: z.string(),
  categoryName: z.string(),
  // Mean of effective 1–5 grades across the category's non-archived skills,
  // with no_concept excluded from the denominator and not_legal counting as 0.
  // null when nothing in the category is assessed yet.
  average: z.number().nullable(),
  assessedCount: z.number().int().nonnegative(),
  totalCount: z.number().int().nonnegative(),
});
export type ScoreHistoryCategoryRollup = z.infer<typeof ScoreHistoryCategoryRollupSchema>;

export const ScoreHistoryStartSchema = z.object({
  slug: z.string(),
  name: z.string(),
  grade: StartGradeResultSchema,
});
export type ScoreHistoryStart = z.infer<typeof ScoreHistoryStartSchema>;

// Per-date progression tallies. Keys are the plain (side-collapsed) skill
// slug — side-rated skills roll up via `weakerSideGrade` first so coaches
// read these counts in "skills," not "ratings." Voided and corrected
// ratings are dropped exactly like the existing calculations do (via
// `latestEffectiveRatings`), so the counts match what the live progress
// endpoint would report at the same moment in time.
export const ScoreHistoryLevelCountsSchema = z.object({
  level1: z.number().int().nonnegative(),
  level2: z.number().int().nonnegative(),
  level3: z.number().int().nonnegative(),
  level4: z.number().int().nonnegative(),
  level5: z.number().int().nonnegative(),
  notLegal: z.number().int().nonnegative(),
  noConcept: z.number().int().nonnegative(),
});
export type ScoreHistoryLevelCounts = z.infer<typeof ScoreHistoryLevelCountsSchema>;

export const ScoreHistoryPointSchema = z.object({
  sessionDate: z.string().date(),
  // ADR 032: lets the hero / start / golf-score chart link to a specific
  // session's edit page. When multiple sessions share a date, the latest
  // one is the primary.
  sessionId: z.string().uuid(),
  headPositionOverall: z.number().int().min(1).max(5).nullable(),
  categoryRollups: z.array(ScoreHistoryCategoryRollupSchema),
  starts: z.array(ScoreHistoryStartSchema),
  // Progression tallies as of this date (collapsed by side).
  counts: ScoreHistoryLevelCountsSchema,
  // Sum of max(0, currentGrade - firstEverGrade) over every skill that has
  // ever been assessed. Positive-only — a skill drop doesn't subtract. The
  // baseline per skill is its first collapsed grade across the full timeline
  // (not its state on date 1, which may predate that skill's first rating).
  totalLevelsGained: z.number().int().nonnegative(),
  // Count of skills whose current collapsed grade is a numeric value at or
  // above MASTERY_LEVEL. Skills in `not_legal` or `no_concept` don't count,
  // even if their phantom numeric grade would otherwise reach mastery.
  skillsMastered: z.number().int().nonnegative(),
  // Count of skills currently at a numeric 1..5 grade. The transition from
  // "unrated" or "no concept" into numeric is the "learned" moment; this
  // metric is the running total of skills past that transition.
  skillsLearned: z.number().int().nonnegative(),
});
export type ScoreHistoryPoint = z.infer<typeof ScoreHistoryPointSchema>;

export const ScoreHistoryResponseSchema = z.object({
  points: z.array(ScoreHistoryPointSchema),
});
export type ScoreHistoryResponse = z.infer<typeof ScoreHistoryResponseSchema>;

// ── Session edit (ADR 032) ─────────────────────────────────────────────────
// GET /coach/sessions/:id and PATCH /coach/sessions/:id live under the coach
// router. GET returns the current effective state of a session (non-voided,
// non-superseded ratings only). PATCH diffs the submitted state against that
// and writes supersede rows for changed ratings plus one in-place UPDATE for
// changed session metadata, all in a single transaction with one audit log
// row recording previous and new values per changed field.

// Rating body for PATCH: references the current effective rating by its id
// (never the predecessor's id). All fields that could be changed are present.
// Re-runs the same per-rating validators as the create flow so there is one
// source of truth for grade / notLegal / noConcept / measurement pairs.
const PatchSessionRatingBodySchemaBase = z.object({
  ratingId: z.string().uuid(),
  grade: z.number().int().min(1).max(5).nullable(),
  notLegal: z.boolean(),
  noConcept: z.boolean(),
  side: RatingSideSchema.nullable(),
  capacityValue: z.string().nullable(),
  capacityUnit: CapacityUnitSchema.nullable(),
  measurementValue: z.string().nullable(),
  measurementUnit: MeasurementUnitSchema.nullable(),
  golfScoreCategory: GolfScoreCategorySchema.nullable().optional().default(null),
  note: z.string().nullable(),
  faultTags: z.array(z.string()),
});

export const PatchSessionRatingBodySchema = PatchSessionRatingBodySchemaBase.superRefine((val, ctx) => {
  const gradeValid =
    (!val.noConcept && val.grade !== null) ||
    (val.noConcept && val.grade === null);
  if (!gradeValid) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "grade must be 1-5 when noConcept is false; grade must be null when noConcept is true",
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
  if ((val.capacityValue === null) !== (val.capacityUnit === null)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "capacityValue and capacityUnit must both be present or both be absent",
      path: ["capacityValue"],
    });
  }
  if ((val.measurementValue === null) !== (val.measurementUnit === null)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "measurementValue and measurementUnit must both be present or both be absent",
      path: ["measurementValue"],
    });
  }
});
export type PatchSessionRatingBody = z.infer<typeof PatchSessionRatingBodySchema>;

export const PatchSessionBodySchema = z.object({
  sessionDate: z.string().date(),
  context: EvaluationContextSchema,
  // Empty string normalizes to null at the API boundary. Null is the "no
  // priority" state; empty is never meaningful (matches ADR 022 + 0061).
  coachingPriority: z.string().min(1).nullable(),
  breathingPattern: BreathingPatternSchema.nullable(),
  ratings: z.array(PatchSessionRatingBodySchema),
});
export type PatchSessionBody = z.infer<typeof PatchSessionBodySchema>;

export const PatchSessionResponseSchema = z.object({
  sessionId: z.string().uuid(),
  writeCount: z.number().int().nonnegative(),
});
export type PatchSessionResponse = z.infer<typeof PatchSessionResponseSchema>;

export const GetSessionRatingSchema = z.object({
  // Current effective rating id. When the rating has never been corrected
  // this equals rootRatingId; after a correction, it's the leaf.
  ratingId: z.string().uuid(),
  rootRatingId: z.string().uuid(),
  skillId: z.string().uuid(),
  slug: z.string(),
  grade: z.number().int().min(1).max(5).nullable(),
  notLegal: z.boolean(),
  noConcept: z.boolean(),
  side: RatingSideSchema.nullable(),
  capacityValue: z.string().nullable(),
  capacityUnit: CapacityUnitSchema.nullable(),
  measurementValue: z.string().nullable(),
  measurementUnit: MeasurementUnitSchema.nullable(),
  golfScoreCategory: GolfScoreCategorySchema.nullable(),
  note: z.string().nullable(),
  faultTags: z.array(z.string()),
  // Preserved observation time; equals the original rated_at even on
  // correction rows.
  ratedAt: z.string().datetime({ offset: true }),
  // True when this is a correction leaf (supersedes_rating_id IS NOT NULL).
  edited: z.boolean(),
});
export type GetSessionRating = z.infer<typeof GetSessionRatingSchema>;

export const GetSessionResponseSchema = z.object({
  sessionId: z.string().uuid(),
  screenSlug: z.string(),
  swimmerId: z.string().uuid(),
  categoryId: z.string().uuid().nullable(),
  sessionDate: z.string().date(),
  context: EvaluationContextSchema,
  coachingPriority: z.string().nullable(),
  breathingPattern: BreathingPatternSchema.nullable(),
  edited: z.boolean(),
  editedAt: z.string().datetime({ offset: true }).nullable(),
  ratings: z.array(GetSessionRatingSchema),
});
export type GetSessionResponse = z.infer<typeof GetSessionResponseSchema>;

// GET /coach/swimmers/:id/evaluations — paginated list of a swimmer's past
// evaluations, newest first. The list page and the swimmer-detail card both
// consume this. Cursor is opaque: encodes the (sessionDate, sessionId) of
// the last item so same-date corrections tie-break deterministically.
export const GetEvaluationsItemSchema = z.object({
  sessionId: z.string().uuid(),
  screenSlug: z.string(),
  screenName: z.string(),
  sessionDate: z.string().date(),
  context: EvaluationContextSchema,
  coachingPriority: z.string().nullable(),
  // Number of live (non-voided, non-superseded) ratings on this session.
  ratingCount: z.number().int().nonnegative(),
  edited: z.boolean(),
  editedAt: z.string().datetime({ offset: true }).nullable(),
  createdAt: z.string().datetime({ offset: true }),
});
export type GetEvaluationsItem = z.infer<typeof GetEvaluationsItemSchema>;

export const GetEvaluationsResponseSchema = z.object({
  evaluations: z.array(GetEvaluationsItemSchema),
  nextCursor: z.string().nullable(),
});
export type GetEvaluationsResponse = z.infer<typeof GetEvaluationsResponseSchema>;

export const GetEvaluationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  cursor: z.string().optional(),
});
export type GetEvaluationsQuery = z.infer<typeof GetEvaluationsQuerySchema>;

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

// Single-latest priority surfaced in the parent progress view and the swimmer
// profile's current-focus card. Null when the swimmer has never had a priority
// written on any session with at least one non-voided rating.
export const LatestCoachingPrioritySchema = z.object({
  text: z.string().min(1),
  sessionDate: z.string(),
});
export type LatestCoachingPriority = z.infer<typeof LatestCoachingPrioritySchema>;

export const ParentSwimmerProgressResponseSchema = SwimmerProgressResponseSchema.extend({
  skills: z.array(ParentSkillProgressSchema),
  latestCoachingNotes: z.array(ParentCoachingNoteSchema),
  latestCoachingPriority: LatestCoachingPrioritySchema.nullable(),
});
export type ParentSwimmerProgressResponse = z.infer<typeof ParentSwimmerProgressResponseSchema>;
