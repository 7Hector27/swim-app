// Account deletion schemas (ADR 034). Immediate deletion gated by server-side
// re-authentication (password re-entry) + a typed confirmation phrase. The
// preview endpoint returns the counts the UI shows on the confirmation screen.

import { z } from "zod";

// The exact phrase a parent must type to prove they meant to click the button.
// Compared case-sensitively on the server. Any divergence here is a semantic
// change and needs a plan + ADR update, not a silent tweak.
export const DELETION_CONFIRMATION_PHRASE = "delete my account";

export const DeletionPreviewResponseSchema = z
  .object({
    householdName: z.string(),
    memberCount: z.number().int().nonnegative(),
    swimmers: z
      .array(
        z.object({
          firstName: z.string(),
          lastInitial: z.string(),
        }),
      )
      .readonly(),
    pastLessonCount: z.number().int().nonnegative(),
    futureLessonCount: z.number().int().nonnegative(),
    // True when the caller is the household owner and other members remain.
    // The UI disables the confirm button and surfaces the transfer-first
    // flow instead. See ADR 034.
    ownerMustTransferFirst: z.boolean(),
  })
  .strict();

export type DeletionPreviewResponse = z.infer<typeof DeletionPreviewResponseSchema>;

export const DeletionConfirmBodySchema = z
  .object({
    // Re-authentication payload; verified server-side against the caller's
    // own email via supabase.auth.signInWithPassword. Never trusted from the
    // client beyond "did the password check pass right now."
    password: z.string().min(1).max(128),
    // Must equal DELETION_CONFIRMATION_PHRASE exactly; defends against
    // accidentally-clicked confirms.
    confirmationPhrase: z.string(),
  })
  .strict();

export type DeletionConfirmBody = z.infer<typeof DeletionConfirmBodySchema>;
