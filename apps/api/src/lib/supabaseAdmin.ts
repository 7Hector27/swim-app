// Supabase admin client — service-role key, used for operations that need
// to cross the row-level-security boundary. Scope today is narrow:
// `auth.admin.deleteUser` for the account-deletion flow (ADR 034).
//
// Separate from the regular `supabase` client (which uses the publishable
// key) so a stray call-site can't accidentally bypass RLS against the
// service role.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getEnv } from "./env";

let cached: SupabaseClient | undefined;

export function getSupabaseAdmin(): SupabaseClient {
  if (cached) return cached;
  const env = getEnv();
  if (!env.supabaseServiceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set — the admin client is required for " +
        "account deletion and other service-role operations.",
    );
  }
  cached = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

// Proxy export so call-sites can keep `supabaseAdmin.auth.admin.deleteUser(…)`
// shape — the lazy getter only runs on first property access, which keeps
// test setups that don't configure the service-role key from crashing at
// import time.
export const supabaseAdmin: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getSupabaseAdmin();
    const value = (client as unknown as Record<string | symbol, unknown>)[prop];
    return typeof value === "function" ? value.bind(client) : value;
  },
});
