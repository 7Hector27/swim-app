// Plain module (no "use server" / "use client" directive) — imported by
// both the server page's pre-fetch wrapper and the client component. Per
// CLAUDE.md's server/client-boundary rules, helpers reused across the
// boundary live in a directive-less file. The "use server" rule also
// requires Server Actions files to export ONLY async functions, so the
// DeleteAccountState union and its initial value live here, not in
// deleteAccountActions.ts.

import type { DeletionPreviewResponse } from "@swim-app/shared";

// Discriminated-union state for useActionState. The UI switches on
// `.status` to render the right inline message. "success" is not a
// state the UI ever sees — the server action redirects before
// returning, so Next.js replaces the page on the happy path.
export type DeleteAccountState =
  | { status: "idle" }
  | { status: "missing_fields" }
  | { status: "phrase_mismatch" }
  | { status: "invalid_password" }
  | { status: "must_transfer_first" }
  | { status: "already_deleted" }
  | { status: "rate_limited"; retryAfterSeconds: number | null }
  | { status: "generic_error" };

export const initialDeleteAccountState: DeleteAccountState = { status: "idle" };

// Four cases the UI renders. Derived from preview.callerRole + member
// count + ownerMustTransferFirst. Owning the mapping here keeps the
// client component simple and the decision auditable in one place.
export type DeleteAccountCase =
  | "solo_alone" // Only member of the household — full teardown.
  | "solo_owner_with_viewers" // Owner, other members are all viewers — teardown, viewers released.
  | "leave" // Non-owner with other adults — only this member leaves.
  | "blocked_owner_must_transfer"; // Owner with other adults — not allowed, transfer first.

export function classifyDeleteAccountCase(preview: DeletionPreviewResponse): DeleteAccountCase {
  if (preview.ownerMustTransferFirst) return "blocked_owner_must_transfer";
  // callerRole is null only for the orphan-profile fallback the API
  // returns when the profile has no household_members row. The API-side
  // deletion engine runs a full solo teardown on that branch, so the
  // UI must match: "solo_alone" shows the teardown copy, not the
  // "you'll be removed from this household" leave copy that the
  // memberCount > 1 fallthrough would otherwise produce.
  if (preview.callerRole === null) return "solo_alone";
  if (preview.memberCount <= 1) return "solo_alone";
  if (preview.callerRole === "owner") return "solo_owner_with_viewers";
  return "leave";
}

export function formatRetryAfterMinutes(retryAfterSeconds: number | null): string {
  if (retryAfterSeconds === null || retryAfterSeconds <= 0) {
    return "in an hour";
  }
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  if (minutes === 1) return "in 1 minute";
  if (minutes < 60) return `in ${minutes} minutes`;
  const hours = Math.ceil(minutes / 60);
  if (hours === 1) return "in 1 hour";
  return `in ${hours} hours`;
}
