import { z } from "zod";

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
