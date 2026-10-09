import { redirect } from "next/navigation";

import type { MeResponse } from "@swim-app/shared";

import { fetchMe } from "@/lib/api/me";
import { createClient } from "@/lib/supabase/server";

export interface AuthResult {
  profile: MeResponse;
  email: string;
}

export async function requireAuth(): Promise<AuthResult | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data) redirect("/login");

  const email = data.claims["email"] as string;

  const result = await fetchMe();
  if (!result.ok) {
    if (result.status === 403) return null;
    redirect("/login");
  }

  return { profile: result.profile, email };
}
