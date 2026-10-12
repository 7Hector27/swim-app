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
    if (result.status === 403) return null;
    throw new Error(`Failed to load session (status ${result.status})`);
  }
  return { profile: result.profile, accessToken: result.accessToken };
});
