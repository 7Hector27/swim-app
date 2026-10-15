import { z } from "zod";

export const AgeGroupSchema = z.enum(["6-under", "7-8", "9-10", "11-12", "13-14", "15-18"]);
export type AgeGroup = z.infer<typeof AgeGroupSchema>;

/** Maps an age in whole years to an age group. Returns null for age > 18. */
export function ageToGroup(age: number): AgeGroup | null {
  if (age <= 6) return "6-under";
  if (age <= 8) return "7-8";
  if (age <= 10) return "9-10";
  if (age <= 12) return "11-12";
  if (age <= 14) return "13-14";
  if (age <= 18) return "15-18";
  return null;
}
