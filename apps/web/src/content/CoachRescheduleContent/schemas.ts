import { z } from "zod";

export const CoachRescheduleStateSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("idle") }),
  z.object({ status: z.literal("error"), message: z.string() }),
]);
export type CoachRescheduleState = z.infer<typeof CoachRescheduleStateSchema>;
