import { z } from "zod";

export const CoachNoteTypeSchema = z.enum([
  "observation",
  "correction",
  "drill",
  "recommendation",
]);
export type CoachNoteType = z.infer<typeof CoachNoteTypeSchema>;

export const TimelineItemTypeSchema = z.enum([
  "note",
  "rating_note",
  "coaching_priority",
]);
export type TimelineItemType = z.infer<typeof TimelineItemTypeSchema>;

export const TimelineItemSchema = z.object({
  type: TimelineItemTypeSchema,
  id: z.string().uuid(),
  body: z.string(),
  createdAt: z.string().datetime({ offset: true }),
  noteType: CoachNoteTypeSchema.optional(),
  tiedTo: z
    .object({
      sessionId: z.string().uuid().optional(),
      lessonId: z.string().uuid().optional(),
      skillId: z.string().uuid().optional(),
    })
    .optional(),
});
export type TimelineItem = z.infer<typeof TimelineItemSchema>;

export const TimelineResponseSchema = z.array(TimelineItemSchema);
export type TimelineResponse = z.infer<typeof TimelineResponseSchema>;

export const CreateCoachNoteBodySchema = z.object({
  body: z.string().min(1),
  noteType: CoachNoteTypeSchema,
  sessionId: z.string().uuid().optional(),
  lessonId: z.string().uuid().optional(),
  skillId: z.string().uuid().optional(),
});
export type CreateCoachNoteBody = z.infer<typeof CreateCoachNoteBodySchema>;

export const UpdateCoachNoteBodySchema = z.object({
  body: z.string().min(1),
  noteType: CoachNoteTypeSchema,
  skillId: z.string().uuid().nullable().optional(),
});
export type UpdateCoachNoteBody = z.infer<typeof UpdateCoachNoteBodySchema>;

export const CoachNoteResponseSchema = z.object({
  id: z.string().uuid(),
  swimmerId: z.string().uuid(),
  sessionId: z.string().uuid().nullable(),
  lessonId: z.string().uuid().nullable(),
  body: z.string(),
  createdBy: z.string().uuid(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type CoachNoteResponse = z.infer<typeof CoachNoteResponseSchema>;
