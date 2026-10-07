import { z } from "zod";

export const MeResponseSchema = z.object({
  fullName: z.string().nullable(),
  phone: z.string().nullable(),
  role: z.enum(["coach", "parent"]),
});

export type MeResponse = z.infer<typeof MeResponseSchema>;

export const PatchMeBodySchema = z
  .object({
    fullName: z.string().trim().min(1).max(100).optional(),
    phone: z.string().max(30).nullable().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: "At least one field is required",
  });

export type PatchMeBody = z.infer<typeof PatchMeBodySchema>;

export const CoachPingResponseSchema = z.object({
  pong: z.literal(true),
});

export type CoachPingResponse = z.infer<typeof CoachPingResponseSchema>;
