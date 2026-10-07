import { z } from "zod";

export const MeResponseSchema = z.object({
  fullName: z.string().nullable(),
  phone: z.string().nullable(),
  role: z.enum(["coach", "parent"]),
});

export type MeResponse = z.infer<typeof MeResponseSchema>;

export const CoachPingResponseSchema = z.object({
  pong: z.literal(true),
});

export type CoachPingResponse = z.infer<typeof CoachPingResponseSchema>;
