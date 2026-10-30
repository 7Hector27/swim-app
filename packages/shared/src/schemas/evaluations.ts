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

// Last-20 effective-grade transitions across every (skill, side) key. Level-ups
// and drops both land here; the direction flag lets the UI mark drops without
// re-deriving numeric order (not_legal / no_concept aren't numerically ordered
// with 1..5). `fromGrade` and `toGrade` are the SkillGrade union; the first
// rating of a skill produces no change event — the milestones list owns
// first-ever rated transitions.
export const ScoreHistoryRecentChangeSchema = z.object({
  skillSlug: z.string(),
  skillName: z.string(),
  side: RatingSideSchema.nullable(),
  fromGrade: SkillGradeSchema,
  toGrade: SkillGradeSchema,
  direction: z.enum(["up", "down"]),
  sessionDate: z.string().date(),
  sessionId: z.string().uuid(),
});
export type ScoreHistoryRecentChange = z.infer<typeof ScoreHistoryRecentChangeSchema>;

// Milestones: discrete events worth celebrating. Each variant records the
// first time a criterion was met; a swimmer sees at most one milestone of
// a given type per skill or per event tuple. Newest-first ordering is applied
// at the end — the UI renders this as a scrolling list of wins.
export const ScoreHistoryMilestoneSchema = z.discriminatedUnion("type", [
  // A stroke or skill moving from `not_legal` to a numeric 1..5 grade on the
  // collapsed timeline. Emitted the first date the slug reaches legal after
  // having been not_legal at any earlier point.
  z.object({
    type: z.literal("skill_legal"),
    sessionDate: z.string().date(),
    sessionId: z.string().uuid(),
    skillSlug: z.string(),
    skillName: z.string(),
  }),
  // First time a skill's collapsed grade reaches numeric 1..5 (from unrated
  // or `no_concept`). The "learned" moment, independent of the specific level.
  z.object({
    type: z.literal("skill_learned"),
    sessionDate: z.string().date(),
    sessionId: z.string().uuid(),
    skillSlug: z.string(),
    skillName: z.string(),
  }),
  // First time a skill's collapsed grade reaches MASTERY_LEVEL.
  z.object({
    type: z.literal("skill_mastered"),
    sessionDate: z.string().date(),
    sessionId: z.string().uuid(),
    skillSlug: z.string(),
    skillName: z.string(),
  }),
  // A catalog skill whose declared prerequisites (skill_dependencies table)
  // have all reached numeric 1..5 on the swimmer's timeline. Emits once per
  // skill the first date every prereq is satisfied, independent of whether
  // the dependent skill itself has been rated.
  z.object({
    type: z.literal("skill_unlocked"),
    sessionDate: z.string().date(),
    sessionId: z.string().uuid(),
    skillSlug: z.string(),
    skillName: z.string(),
  }),
  // A new personal best from a meet swim. One milestone per (eventDistance,
  // eventStroke, course) tuple each time a faster meet time is recorded; the
  // first meet time for a tuple also qualifies as a PB.
  z.object({
    type: z.literal("personal_best"),
    sessionDate: z.string().date(),
    eventDistance: z.number().int(),
    eventStroke: z.enum(["free", "back", "breast", "fly", "im"]),
    course: z.enum(["scy", "scm", "lcm"]),
    timeHundredths: z.number().int().positive(),
    meetName: z.string().nullable(),
  }),
]);
export type ScoreHistoryMilestone = z.infer<typeof ScoreHistoryMilestoneSchema>;

// Fault-tag trend series. One entry per fault tag the swimmer received in the
// last 90 days (relative to the request); points cover every session date in
// that window the swimmer had any rating, so a tag's trend can show it going
// to zero. Coach-only — the parent route always returns an empty array for
// faultTrends so a parent client can't observe negative coaching language.
export const ScoreHistoryFaultTrendPointSchema = z.object({
  sessionDate: z.string().date(),
  count: z.number().int().nonnegative(),
});
export type ScoreHistoryFaultTrendPoint = z.infer<typeof ScoreHistoryFaultTrendPointSchema>;

export const ScoreHistoryFaultTrendSchema = z.object({
  faultTag: z.string(),
  points: z.array(ScoreHistoryFaultTrendPointSchema),
});
export type ScoreHistoryFaultTrend = z.infer<typeof ScoreHistoryFaultTrendSchema>;

// Per-skill measurement series. One entry per (skill, unit) pair the swimmer
// has non-voided measurement values for; split by unit so a coach who changed
// unit mid-history gets two cleanly separated lines rather than a smoothed
// mix. Direction lets the chart orient its "better" axis without hardcoding
// per-unit rules in the UI.
export const ScoreHistoryMeasurementPointSchema = z.object({
  sessionDate: z.string().date(),
  sessionId: z.string().uuid(),
  value: z.number(),
});
export type ScoreHistoryMeasurementPoint = z.infer<typeof ScoreHistoryMeasurementPointSchema>;

export const ScoreHistoryMeasurementSeriesSchema = z.object({
  skillSlug: z.string(),
  skillName: z.string(),
  unit: MeasurementUnitSchema,
  direction: z.enum(["higher_better", "lower_better"]),
  // Ascending by sessionDate.
  points: z.array(ScoreHistoryMeasurementPointSchema),
});
export type ScoreHistoryMeasurementSeries = z.infer<typeof ScoreHistoryMeasurementSeriesSchema>;

export const ScoreHistoryResponseSchema = z.object({
  points: z.array(ScoreHistoryPointSchema),
  // Newest first, capped at the 20 most recent effective-grade transitions.
  recentChanges: z.array(ScoreHistoryRecentChangeSchema),
  // Newest first. One entry per unique criterion-and-subject pair.
  milestones: z.array(ScoreHistoryMilestoneSchema),
  // Coach-only. Parent route returns a response that omits this key entirely
  // (see ParentScoreHistoryResponseSchema below).
  faultTrends: z.array(ScoreHistoryFaultTrendSchema),
  // One series per (skill, unit) with at least one measured rating.
  measurements: z.array(ScoreHistoryMeasurementSeriesSchema),
});
export type ScoreHistoryResponse = z.infer<typeof ScoreHistoryResponseSchema>;

// Parent-facing variant. `faultTrends` is coach-only; this schema makes that
// a serialization-boundary invariant rather than an implicit option default.
// The key must be ABSENT in the response (not empty) — Zod's `.strict()`
// refuses any extra keys at parse time, so a future refactor that stops
// stripping fault data trips here instead of silently reaching a parent
// client. Imported by apps/api/src/routes/parentProgress.ts and
// apps/web/src/lib/api/parentProgress.ts.
export const ParentScoreHistoryResponseSchema = ScoreHistoryResponseSchema
  .omit({ faultTrends: true })
  .strict();
export type ParentScoreHistoryResponse = z.infer<typeof ParentScoreHistoryResponseSchema>;

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
