"use server";

import { redirect } from "next/navigation";

import {
  DeletionConfirmBodySchema,
  matchesDeletionConfirmationPhrase,
} from "@swim-app/shared";

import { createClient } from "@/lib/supabase/server";

import type { DeleteAccountState } from "./deleteAccountHelpers";

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const parsed = Number.parseInt(header, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

// Server action handed to <form action={...}>. Returns a state object the
// component renders inline. The one non-return branch is success (204):
// the action signs the user out server-side and redirects to the public
// landing page with a one-time ?account-deleted=1 flag the modal reads,
// so the component never sees a "success" state — Next.js replaces the
// page on redirect. Redirecting back into /account would land on the
// layout's requireAuth() gate (now the user is signed out) and show
// the inactive screen instead of the confirmation.
export async function confirmDeletionAction(
  _prev: DeleteAccountState,
  formData: FormData,
): Promise<DeleteAccountState> {
  const password = (formData.get("password") as string | null) ?? "";
  const confirmationPhrase = (formData.get("confirmationPhrase") as string | null) ?? "";

  if (password.length === 0 || confirmationPhrase.length === 0) {
    return { status: "missing_fields" };
  }
  if (!matchesDeletionConfirmationPhrase(confirmationPhrase)) {
    // Defense in depth. The client disables the button until the phrase
    // matches (same normalization rule), but a crafted form post could
    // skip the disabled state.
    return { status: "phrase_mismatch" };
  }

  const parsed = DeletionConfirmBodySchema.safeParse({ password, confirmationPhrase });
  if (!parsed.success) {
    return { status: "missing_fields" };
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    // The /account page requires auth; the session can only be gone if it
    // expired between page load and this action. Routing to signout is
    // the right UX — the user has to sign in to try again.
    redirect("/api/signout");
  }

  let response: Response;
  try {
    response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/me/deletion/confirm`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(parsed.data),
      cache: "no-store",
    });
  } catch {
    return { status: "generic_error" };
  }

  if (response.status === 204 || response.status === 200) {
    // 200 is the ADR 036 Phase 8 Part B Stop 2 shape: carries a
    // `cashOut.breakdown` with the refunded + written-off cents. We
    // forward both as URL params so the post-deletion modal can render
    // the amounts without a second round-trip. 204 is the legacy shape
    // (leave / orphan / zero-balance) and leaves the params unset.
    let redirectTarget = "/?account-deleted=1";
    if (response.status === 200) {
      try {
        const body = (await response.json()) as {
          cashOut?: {
            breakdown?: { refundableCents?: number; writeOffCents?: number };
          };
        };
        const refundable = body.cashOut?.breakdown?.refundableCents;
        const writeOff = body.cashOut?.breakdown?.writeOffCents;
        const params = new URLSearchParams({ "account-deleted": "1" });
        if (typeof refundable === "number" && refundable > 0) {
          params.set("refunded", String(refundable));
        }
        if (typeof writeOff === "number" && writeOff > 0) {
          params.set("forfeited", String(writeOff));
        }
        redirectTarget = `/?${params.toString()}`;
      } catch {
        // Fall back to the plain flag if the body isn't JSON for any
        // reason. The modal still opens; the amounts just don't show.
      }
    }
    // Success. Sign the user out server-side so the SSR cookie is gone
    // before the post-deletion page renders — the client's local Supabase
    // session (if any) gets cleared on next pageload; the SSR cookie is
    // the only thing requireAuth checks.
    try {
      await supabase.auth.signOut();
    } catch {
      // Best effort — the auth user is being hard-deleted in a post-commit
      // task anyway, so a failed signOut here can't leave a usable session
      // behind for long.
    }
    redirect(redirectTarget);
  }

  if (response.status === 403) {
    // Route returns 403 invalid_password for a wrong confirmation
    // password — distinct from the global 401 convention so this does
    // NOT sign the user out. The 401 sign-out redirect (apps/web/src/lib
    // /requireAuth.ts and every forward action) stays scoped to session
    // expiry.
    const body = (await safeJson(response)) as { error?: unknown };
    if (body.error === "invalid_password") {
      return { status: "invalid_password" };
    }
    return { status: "generic_error" };
  }

  if (response.status === 409) {
    const body = (await safeJson(response)) as { error?: unknown };
    if (body.error === "must_transfer_first") return { status: "must_transfer_first" };
    if (body.error === "already_deleted") return { status: "already_deleted" };
    return { status: "generic_error" };
  }

  if (response.status === 422) {
    // Typed-phrase mismatch at the API. Treated the same as the client
    // catching it — the UI shows the phrase-mismatch message.
    return { status: "phrase_mismatch" };
  }

  if (response.status === 429) {
    const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
    return { status: "rate_limited", retryAfterSeconds: retryAfter };
  }

  return { status: "generic_error" };
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}
