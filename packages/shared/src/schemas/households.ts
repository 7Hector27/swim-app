import { z } from "zod";

export const HouseholdRoleSchema = z.enum(["owner", "manager", "viewer"]);
export type HouseholdRole = z.infer<typeof HouseholdRoleSchema>;

export const HouseholdMemberSchema = z.object({
  profileId: z.string().uuid(),
  role: HouseholdRoleSchema,
  fullName: z.string().nullable(),
  joinedAt: z.string().datetime({ offset: true }),
});

export type HouseholdMember = z.infer<typeof HouseholdMemberSchema>;

export const HouseholdResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  myRole: HouseholdRoleSchema,
  members: z.array(HouseholdMemberSchema),
  swimmerIds: z.array(z.string().uuid()),
});

export type HouseholdResponse = z.infer<typeof HouseholdResponseSchema>;
