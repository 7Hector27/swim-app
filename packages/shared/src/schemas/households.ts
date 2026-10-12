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

export const RenameHouseholdBodySchema = z.object({ name: z.string().min(1).max(50) });
export type RenameHouseholdBody = z.infer<typeof RenameHouseholdBodySchema>;

// Only manager/viewer settable via role-change; owner is only reachable via transfer-ownership.
export const ChangeRoleBodySchema = z.object({ role: z.enum(["manager", "viewer"]) });
export type ChangeRoleBody = z.infer<typeof ChangeRoleBodySchema>;

export const TransferOwnershipBodySchema = z.object({ newOwnerProfileId: z.string().uuid() });
export type TransferOwnershipBody = z.infer<typeof TransferOwnershipBodySchema>;

export const PendingInviteSchema = z
  .object({
    id: z.string().uuid(),
    expiresAt: z.string().datetime({ offset: true }),
    createdAt: z.string().datetime({ offset: true }),
  })
  .nullable();
export type PendingInvite = z.infer<typeof PendingInviteSchema>;

export const ListInviteResponseSchema = z.object({ invite: PendingInviteSchema });
export type ListInviteResponse = z.infer<typeof ListInviteResponseSchema>;
