import { z } from "zod";

export const SwimStrokeSchema = z.enum(["free", "back", "breast", "fly", "im"]);
export type SwimStroke = z.infer<typeof SwimStrokeSchema>;

export const CourseSchema = z.enum(["scy", "scm", "lcm"]);
export type Course = z.infer<typeof CourseSchema>;

// Historical values persisted in the DB. New rows are always `"meet"`; the
// `"practice"` value is retained in the enum only so existing rows parse. See
// docs/decisions/0045-drop-practice-swim-type.md.
export const SwimTypeSchema = z.enum(["meet", "practice"]);
export type SwimType = z.infer<typeof SwimTypeSchema>;

// Reasonable cap: 99:59.99 — longer than any swim event in existence. Keeps
// typos and negative overflow out of the ledger.
export const MAX_SWIM_HUNDREDTHS = 99 * 6000 + 59 * 100 + 99;

// ── Meets ─────────────────────────────────────────────────────────────────────

export const MeetResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  meetDate: z.string(),
  course: CourseSchema,
  swimCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MeetResponse = z.infer<typeof MeetResponseSchema>;

export const CreateMeetBodySchema = z.object({
  name: z.string().min(1),
  meetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  course: CourseSchema,
});
export type CreateMeetBody = z.infer<typeof CreateMeetBodySchema>;

// ── Meet swims ────────────────────────────────────────────────────────────────

export const MeetSwimResponseSchema = z.object({
  id: z.string().uuid(),
  swimmerId: z.string().uuid(),
  swimType: SwimTypeSchema,
  meetId: z.string().uuid().nullable().optional(),
  meetName: z.string().nullable().optional(),
  meetDate: z.string().nullable().optional(),
  eventDistance: z.number().int().positive(),
  eventStroke: SwimStrokeSchema,
  course: CourseSchema,
  timeHundredths: z.number().int(),
  timeString: z.string(),
  swumOn: z.string(),
  createdAt: z.string(),
});
export type MeetSwimResponse = z.infer<typeof MeetSwimResponseSchema>;

// All new swims belong to a meet. `swimType` is implicit (`"meet"`) and no
// longer part of the request body — see ADR 0045.
export const CreateMeetSwimBodySchema = z.object({
  meetId: z.string().uuid(),
  eventDistance: z.number().int().positive(),
  eventStroke: SwimStrokeSchema,
  course: CourseSchema,
  timeString: z.string().min(1),
  swumOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type CreateMeetSwimBody = z.infer<typeof CreateMeetSwimBodySchema>;

// Batch create — POST /coach/meets/:id/swims. Every row is validated and
// inserted in one transaction; a single failing row rolls the whole batch
// back.
export const CreateMeetSwimsBatchRowSchema = z.object({
  swimmerId: z.string().uuid(),
  eventDistance: z.number().int().positive(),
  eventStroke: SwimStrokeSchema,
  course: CourseSchema,
  timeString: z.string().min(1),
  swumOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type CreateMeetSwimsBatchRow = z.infer<typeof CreateMeetSwimsBatchRowSchema>;

export const CreateMeetSwimsBatchBodySchema = z.object({
  rows: z.array(CreateMeetSwimsBatchRowSchema).min(1),
});
export type CreateMeetSwimsBatchBody = z.infer<typeof CreateMeetSwimsBatchBodySchema>;

// When the batch fails validation, the response lists one error per failing
// row (keyed by its index in the submitted array). No rows are persisted.
export const BatchRowErrorSchema = z.object({
  index: z.number().int().nonnegative(),
  error: z.string(),
});
export type BatchRowError = z.infer<typeof BatchRowErrorSchema>;

export const CreateMeetSwimsBatchErrorSchema = z.object({
  error: z.literal("batch_validation_failed"),
  rowErrors: z.array(BatchRowErrorSchema),
});
export type CreateMeetSwimsBatchError = z.infer<typeof CreateMeetSwimsBatchErrorSchema>;

export const PatchMeetSwimBodySchema = z
  .object({
    timeString: z.string().min(1).optional(),
    swumOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    eventDistance: z.number().int().positive().optional(),
    eventStroke: SwimStrokeSchema.optional(),
  })
  .refine((obj) => Object.keys(obj).length > 0, {
    message: "at least one field required",
  });
export type PatchMeetSwimBody = z.infer<typeof PatchMeetSwimBodySchema>;

// ── Meet with swims (GET /coach/meets/:id) ────────────────────────────────────

// Swim shape for the meet-detail endpoint. Includes swimmer identity so the
// coach UI can group results by event + show who swam what.
export const MeetDetailSwimResponseSchema = z.object({
  id: z.string().uuid(),
  swimmerId: z.string().uuid(),
  swimmerFirstName: z.string(),
  swimmerLastName: z.string(),
  swimType: SwimTypeSchema,
  meetId: z.string().uuid().nullable().optional(),
  meetName: z.string().nullable().optional(),
  meetDate: z.string().nullable().optional(),
  eventDistance: z.number().int().positive(),
  eventStroke: SwimStrokeSchema,
  course: CourseSchema,
  timeHundredths: z.number().int(),
  timeString: z.string(),
  swumOn: z.string(),
  createdAt: z.string(),
});
export type MeetDetailSwimResponse = z.infer<typeof MeetDetailSwimResponseSchema>;

export const MeetWithSwimsResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  meetDate: z.string(),
  course: CourseSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  swims: z.array(MeetDetailSwimResponseSchema),
});
export type MeetWithSwimsResponse = z.infer<typeof MeetWithSwimsResponseSchema>;

// PATCH /coach/meets/:id — edit header fields.
export const PatchMeetBodySchema = z
  .object({
    name: z.string().min(1).optional(),
    meetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    course: CourseSchema.optional(),
  })
  .refine((obj) => Object.keys(obj).length > 0, {
    message: "at least one field required",
  });
export type PatchMeetBody = z.infer<typeof PatchMeetBodySchema>;

// ── Personal best ─────────────────────────────────────────────────────────────

export const PersonalBestSchema = z.object({
  eventDistance: z.number().int().positive(),
  eventStroke: SwimStrokeSchema,
  course: CourseSchema,
  timeHundredths: z.number().int(),
  timeString: z.string(),
  swimId: z.string().uuid(),
});
export type PersonalBest = z.infer<typeof PersonalBestSchema>;

export const MeetSwimsResponseSchema = z.object({
  swims: z.array(MeetSwimResponseSchema),
  personalBests: z.array(PersonalBestSchema),
});
export type MeetSwimsResponse = z.infer<typeof MeetSwimsResponseSchema>;

// ── Parent personal best ──────────────────────────────────────────────────────

// Parent-facing personal best: same best-time logic as the coach side, with
// the meet date and name joined on so parents can see where a PB was swum.
// Practice swims are excluded, matching the coach PB computation.
export const ParentPersonalBestSchema = z.object({
  eventDistance: z.number().int().positive(),
  eventStroke: SwimStrokeSchema,
  course: CourseSchema,
  timeHundredths: z.number().int(),
  timeString: z.string(),
  meetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  meetName: z.string().nullable(),
});
export type ParentPersonalBest = z.infer<typeof ParentPersonalBestSchema>;

export const ParentPersonalBestsResponseSchema = z
  .object({
    personalBests: z.array(ParentPersonalBestSchema),
  })
  .strict();
export type ParentPersonalBestsResponse = z.infer<typeof ParentPersonalBestsResponseSchema>;

// ── Parent swimmer summary (dashboard) ────────────────────────────────────────

// One row per swimmer in the parent's household. Powers the swimmer cards on
// the parent dashboard. See GET /swimmers/me/summary. The response is
// `.strict()` so any coach-only field slipping into the server response fails
// the parse boundary instead of silently reaching a parent client.
export const ParentSwimmerSummaryNextLessonSchema = z
  .object({
    startsAt: z.string().datetime({ offset: true }),
    durationMinutes: z.number().int().positive(),
    locationName: z.string(),
  })
  .strict();
export type ParentSwimmerSummaryNextLesson = z.infer<
  typeof ParentSwimmerSummaryNextLessonSchema
>;

export const ParentSwimmerSummaryBestEventSchema = z
  .object({
    label: z.string().min(1),
    timeString: z.string().min(1),
  })
  .strict();
export type ParentSwimmerSummaryBestEvent = z.infer<
  typeof ParentSwimmerSummaryBestEventSchema
>;

export const ParentSwimmerSummarySchema = z
  .object({
    swimmerId: z.string().uuid(),
    nextLesson: ParentSwimmerSummaryNextLessonSchema.nullable(),
    lastEvaluatedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    bestEvent: ParentSwimmerSummaryBestEventSchema.nullable(),
    onLeaderboards: z.boolean(),
  })
  .strict();
export type ParentSwimmerSummary = z.infer<typeof ParentSwimmerSummarySchema>;

export const ParentSwimmerSummariesResponseSchema = z
  .object({
    summaries: z.array(ParentSwimmerSummarySchema),
  })
  .strict();
export type ParentSwimmerSummariesResponse = z.infer<
  typeof ParentSwimmerSummariesResponseSchema
>;
