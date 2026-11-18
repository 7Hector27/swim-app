// Ephemeral Supabase auth client for re-auth checks that must NOT leave a
// session behind. The password-change (POST /auth/change-password) and
// account-deletion (POST /me/deletion/confirm per ADR 034) flows both
// re-verify the caller's password by calling signInWithPassword on a
// throwaway client, then immediately sign that single session out with
// `scope: "local"` so the caller's live browser session is unaffected.
//
// Factored out so both call sites share the exact persistSession:false /
// autoRefreshToken:false configuration; a drift there would leak a real
// session into the callers' cookies on next request.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getEnv } from "./env";

export function createNonPersistingAuthClient(): SupabaseClient {
  const env = getEnv();
  return createClient(env.supabaseUrl, env.supabasePublishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
