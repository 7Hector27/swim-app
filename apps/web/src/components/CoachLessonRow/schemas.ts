import { z } from "zod";

export const CoachLessonActionStateSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("idle") }),
  z.object({ status: z.literal("success") }),
  z.object({ status: z.literal("error"), message: z.string() }),
]);
export type CoachLessonActionState = z.infer<typeof CoachLessonActionStateSchema>;
