import { z } from "zod";

export const HouseholdRoleSchema = z.enum(["owner", "manager", "viewer"]);
export type HouseholdRole = z.infer<typeof HouseholdRoleSchema>;

/** Rank map for comparing household roles. Higher number = more permissions. */
export const HOUSEHOLD_ROLE_RANK: Record<HouseholdRole, number> = {
  viewer: 0,
  manager: 1,
  owner: 2,
};

export const HouseholdMemberSchema = z.object({
  // Owners see profileId for all members; other roles see only role, fullName, joinedAt.
  profileId: z.string().uuid().optional(),
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
