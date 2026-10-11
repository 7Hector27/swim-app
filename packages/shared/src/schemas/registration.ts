import { z } from "zod";

export const LeagueSchema = z.enum(["club", "summer_league"]);
export type League = z.infer<typeof LeagueSchema>;

export const LeagueRegistrationParamsSchema = z.object({
  id: z.string().uuid(),
  league: LeagueSchema,
});
export type LeagueRegistrationParams = z.infer<typeof LeagueRegistrationParamsSchema>;
