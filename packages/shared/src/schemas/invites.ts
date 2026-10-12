import { z } from "zod";

export const InviteStatusSchema = z.enum(["pending", "expired", "revoked", "accepted"]);
export type InviteStatus = z.infer<typeof InviteStatusSchema>;

export const InviteStatusResponseSchema = z.object({
  householdName: z.string(),
  status: InviteStatusSchema,
});
export type InviteStatusResponse = z.infer<typeof InviteStatusResponseSchema>;

export const GenerateInviteResponseSchema = z.object({
  id: z.string().uuid(),
  url: z.string().url(),
  expiresAt: z.string().datetime({ offset: true }),
});
export type GenerateInviteResponse = z.infer<typeof GenerateInviteResponseSchema>;

export const AcceptInviteResponseSchema = z.object({
  householdId: z.string().uuid(),
});
export type AcceptInviteResponse = z.infer<typeof AcceptInviteResponseSchema>;
