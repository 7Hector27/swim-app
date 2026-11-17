"use server";

import { publicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export type ResendState =
  | { status: "idle" }
  | { status: "sent" }
  | { status: "no_session" }
  | { status: "error"; message: string };

// Resend the Supabase signup-confirmation email for the currently
// signed-in-but-unconfirmed user. Supabase has its own per-email resend
// throttle; we don't add a second one here because the per-email limiter
// already protects the API's /auth/signup route and Supabase's throttle
// covers this call.
export async function resendConfirmationAction(): Promise<ResendState> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  const email = data.session?.user.email;
  if (!email) {
    return { status: "no_session" };
  }
  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
    options: {
      emailRedirectTo: `${publicEnv.siteUrl}/auth/confirm`,
    },
  });
  if (error) {
    return { status: "error", message: error.message };
  }
  return { status: "sent" };
}
