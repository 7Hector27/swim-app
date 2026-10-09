import { cache } from "react";
import { redirect } from "next/navigation";

import type { MeResponse } from "@swim-app/shared";

import { fetchMe } from "@/lib/api/me";

export interface AuthResult {
  profile: MeResponse;
}

export const requireAuth = cache(async function requireAuth(): Promise<AuthResult | null> {
  const result = await fetchMe();
  if (!result.ok) {
    if (result.status === 403) return null;
    redirect("/login");
  }

  return { profile: result.profile };
});
