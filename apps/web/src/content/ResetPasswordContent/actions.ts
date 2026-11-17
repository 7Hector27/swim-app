"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { PasswordSchema } from "@swim-app/shared";

import { createClient } from "@/lib/supabase/server";

// Server-side reset flow. Moving this off the browser Supabase client was
// deliberate: when the previous client-side flow called verifyOtp it wrote
// cookies via document.cookie, which the already-streamed server layout
// couldn't know about — the Header kept showing "Log in" while the page
// internally held a session. Keeping every auth mutation in a Server
// Action means the server and the client always agree on the session
// (both read the same cookie store on each render).

export type ResetSubmitState =
  | { status: "idle" }
  | { status: "invalid_link" }
  | { status: "weak_password" }
  | { status: "mismatch" }
  | { status: "error"; message: string };

export async function completeReset(
  _prev: ResetSubmitState,
  formData: FormData,
): Promise<ResetSubmitState> {
  const tokenHash = formData.get("tokenHash");
  const newPassword = formData.get("newPassword");
  const confirmPassword = formData.get("confirmPassword");

  if (typeof tokenHash !== "string" || tokenHash.length === 0) {
    return { status: "invalid_link" };
  }
  if (typeof newPassword !== "string" || typeof confirmPassword !== "string") {
    return { status: "error", message: "Enter and confirm your new password." };
  }
  if (newPassword !== confirmPassword) {
    return { status: "mismatch" };
  }
  const parsedPassword = PasswordSchema.safeParse(newPassword);
  if (!parsedPassword.success) {
    return { status: "weak_password" };
  }

  const supabase = await createClient();

  // verifyOtp consumes the token and establishes the recovery session on
  // the server-side cookies. A bad/expired token is the common failure
  // and gets its own user-facing branch.
  const { error: verifyError } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: "recovery",
  });
  if (verifyError) {
    return { status: "invalid_link" };
  }

  const { error: updateError } = await supabase.auth.updateUser({
    password: parsedPassword.data,
  });
  if (updateError) {
    // The recovery session was established above; don't leave it hanging.
    try {
      await supabase.auth.signOut({ scope: "global" });
    } catch {
      /* best-effort */
    }
    await wipeResidualAuthCookies();
    return {
      status: "error",
      message: "Could not update your password. Please try again.",
    };
  }

  // Fire the "Your password was changed" email while the recovery session
  // is still live — the Bearer token below is invalidated by the signOut
  // that follows.
  try {
    const { data } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;
    if (accessToken) {
      await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/auth/notify-password-changed`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          cache: "no-store",
        },
      );
    }
  } catch {
    /* best-effort — the confirmation email is non-blocking */
  }

  // Global sign-out: revokes the recovery session AND every other active
  // session for this user (desktop, other browsers). `@supabase/ssr`'s
  // signOut clears the auth cookies through the cookie adapter;
  // wipeResidualAuthCookies below is a belt-and-suspenders wipe in case
  // a chunked cookie name variant slips through.
  try {
    await supabase.auth.signOut({ scope: "global" });
  } catch {
    /* best-effort */
  }
  await wipeResidualAuthCookies();

  redirect("/login?notice=password-updated");
}

// Supabase SSR stores the session under `sb-<project-ref>-auth-token`,
// chunked into `.0`, `.1`, ... for large tokens. After signOut the adapter
// should have cleared them; if a variant slips through (e.g. a stale
// chunk), this makes sure the layout's next render sees a cookie-free
// request.
async function wipeResidualAuthCookies(): Promise<void> {
  const store = await cookies();
  for (const cookie of store.getAll()) {
    if (/^sb-.*-auth-token/.test(cookie.name)) {
      store.delete(cookie.name);
    }
  }
}
