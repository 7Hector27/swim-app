import { z } from "zod";

export const SwimStrokeSchema = z.enum(["free", "back", "breast", "fly", "im"]);
export type SwimStroke = z.infer<typeof SwimStrokeSchema>;

export const CourseSchema = z.enum(["scy", "scm", "lcm"]);
export type Course = z.infer<typeof CourseSchema>;

export const SwimTypeSchema = z.enum(["meet", "practice"]);
export type SwimType = z.infer<typeof SwimTypeSchema>;

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

export const CreateMeetSwimBodySchema = z
  .object({
    swimType: SwimTypeSchema.default("meet"),
    meetId: z.string().uuid().optional(),
    eventDistance: z.number().int().positive(),
    eventStroke: SwimStrokeSchema,
    course: CourseSchema,
    timeString: z.string().min(1),
    swumOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .superRefine((data, ctx) => {
    if (data.swimType === "meet" && data.meetId === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "meetId is required for meet swims",
        path: ["meetId"],
      });
    }
  });
export type CreateMeetSwimBody = z.infer<typeof CreateMeetSwimBodySchema>;

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

// Swim shape for the meet-detail endpoint. Excludes swimmerId — it is an
// internal UUID that has no benefit to API consumers viewing a meet's swims.
export const MeetDetailSwimResponseSchema = z.object({
  id: z.string().uuid(),
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

export const ParentPersonalBestsResponseSchema = z.object({
  personalBests: z.array(ParentPersonalBestSchema),
});
export type ParentPersonalBestsResponse = z.infer<typeof ParentPersonalBestsResponseSchema>;
