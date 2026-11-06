// Account deletion schemas (ADR 034). Immediate deletion gated by server-side
// re-authentication (password re-entry) + a typed confirmation phrase. The
// preview endpoint returns the counts the UI shows on the confirmation screen.

import { z } from "zod";

// The phrase a parent must type to prove they meant to click the button.
// Mobile keyboards autocapitalize the first word — "Delete" is a
// genuinely-intended input that would otherwise fail a strict ===. The
// comparison trims surrounding whitespace and lowercases both sides; the
// phrase itself is kept lowercase so the UI can show the canonical form.
// Any divergence of this constant is a semantic change and needs a plan +
// ADR update, not a silent tweak.
export const DELETION_CONFIRMATION_PHRASE = "delete";

// Normalizes an input phrase for comparison. Used by the client's button-
// enablement check, the web Server Action's defense-in-depth check, and
// the API route's authoritative check so all three paths agree on what
// counts as a match.
export function matchesDeletionConfirmationPhrase(input: string): boolean {
  return input.trim().toLowerCase() === DELETION_CONFIRMATION_PHRASE;
}

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
    // Caller's household role. The Phase 4 confirmation UI branches copy
    // on this so "leave" (non-owner with others present) and "solo —
    // owner with only viewers" render distinct explanations. Nullable
    // only for the shouldn't-happen "profile with no household"
    // fallback — a caller that passed requireUser always has one.
    callerRole: z.enum(["owner", "manager", "viewer"]).nullable(),
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
