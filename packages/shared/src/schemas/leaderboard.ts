import { z } from "zod";
import { SexSchema } from "./swimmer";
import { SwimStrokeSchema, CourseSchema } from "./meets";
import { AgeGroupSchema } from "../lib/ageGroup";

export type { AgeGroup } from "../lib/ageGroup";
export { AgeGroupSchema };

export const MotivationalStandardNameSchema = z.enum(["B", "BB", "A", "AA", "AAA", "AAAA"]);
export type MotivationalStandardName = z.infer<typeof MotivationalStandardNameSchema>;

export const LeaderboardQuerySchema = z.object({
  eventDistance: z.coerce.number().int().positive().optional(),
  eventStroke: SwimStrokeSchema.optional(),
  course: CourseSchema.optional(),
  ageGroup: AgeGroupSchema.optional(),
  sex: SexSchema.optional(),
});
export type LeaderboardQuery = z.infer<typeof LeaderboardQuerySchema>;

export const PublicBoardRowSchema = z.object({
  firstName: z.string(),
  lastInitial: z.string(),
  ageGroup: AgeGroupSchema,
  sex: SexSchema,
  time: z.string(),
  eventDistance: z.number().int(),
  eventStroke: SwimStrokeSchema,
  course: CourseSchema,
  rank: z.number().int(),
});
export type PublicBoardRow = z.infer<typeof PublicBoardRowSchema>;

export const PublicMasterRowSchema = PublicBoardRowSchema.extend({
  standard: MotivationalStandardNameSchema,
});
export type PublicMasterRow = z.infer<typeof PublicMasterRowSchema>;

export const PublicBoardResponseSchema = z.object({
  rows: z.array(PublicBoardRowSchema),
});
export type PublicBoardResponse = z.infer<typeof PublicBoardResponseSchema>;

export const PublicMasterResponseSchema = z.object({
  standardsAvailable: z.boolean(),
  rows: z.array(PublicMasterRowSchema),
});
export type PublicMasterResponse = z.infer<typeof PublicMasterResponseSchema>;

export const CoachBoardRowSchema = z.object({
  firstName: z.string(),
  lastName: z.string(),
  ageGroup: AgeGroupSchema,
  sex: SexSchema,
  time: z.string(),
  eventDistance: z.number().int(),
  eventStroke: SwimStrokeSchema,
  course: CourseSchema,
  rank: z.number().int(),
});
export type CoachBoardRow = z.infer<typeof CoachBoardRowSchema>;

export const CoachMasterRowSchema = CoachBoardRowSchema.extend({
  standard: MotivationalStandardNameSchema,
});
export type CoachMasterRow = z.infer<typeof CoachMasterRowSchema>;

export const CoachBoardResponseSchema = z.object({
  rows: z.array(CoachBoardRowSchema),
});
export type CoachBoardResponse = z.infer<typeof CoachBoardResponseSchema>;

export const CoachMasterResponseSchema = z.object({
  standardsAvailable: z.boolean(),
  rows: z.array(CoachMasterRowSchema),
});
export type CoachMasterResponse = z.infer<typeof CoachMasterResponseSchema>;
