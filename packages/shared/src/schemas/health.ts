import { z } from "zod";

export const HealthQuerySchema = z.object({});

export const HealthResponseSchema = z.object({
  status: z.enum(["ok", "error"]),
  db: z.boolean(),
  timestamp: z.string(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
