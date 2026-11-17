import { cache } from "react";
import { redirect } from "next/navigation";

import type { MeResponse } from "@swim-app/shared";

import { fetchMe } from "@/lib/api/me";

export interface AuthResult {
  profile: MeResponse;
  accessToken: string;
}

export const requireAuth = cache(async function requireAuth(): Promise<AuthResult | null> {
  const result = await fetchMe();
  if (!result.ok) {
    if (result.status === 401) redirect("/api/signout");
    // Audit item 10 — the API returns 403 { error: "email_not_confirmed" }
    // for a signed-in user whose Supabase email_confirmed_at is still null.
    // Route them to a dedicated page that explains the state and offers a
    // resend link; falling back to the generic null-return would blank
    // the page silently and leave the user stuck.
    if (result.status === 403 && result.errorCode === "email_not_confirmed") {
      redirect("/auth/confirm-pending");
    }
    if (result.status === 403) return null;
    throw new Error(`Failed to load session (status ${result.status})`);
  }
  return { profile: result.profile, accessToken: result.accessToken };
});
