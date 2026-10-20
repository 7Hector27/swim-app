import { z } from "zod";

export const CoachLessonDetailStateSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("idle") }),
  z.object({ status: z.literal("error"), message: z.string() }),
]);
export type CoachLessonDetailState = z.infer<typeof CoachLessonDetailStateSchema>;
