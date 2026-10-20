import { cache } from "react";

import { HouseholdResponseSchema, ListInviteResponseSchema, type HouseholdResponse, type PendingInvite } from "@swim-app/shared";

import { apiFetch } from "./apiFetch";

export const fetchHousehold = cache(async function fetchHousehold(accessToken: string): Promise<HouseholdResponse | null> {
  try {
    const response = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL}/households/mine`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const parsed = HouseholdResponseSchema.safeParse(body);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
});

export async function fetchPendingInvite(accessToken: string): Promise<PendingInvite | null> {
  try {
    const response = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL}/households/mine/invites`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const parsed = ListInviteResponseSchema.safeParse(body);
    return parsed.success ? parsed.data.invite : null;
  } catch {
    return null;
  }
}
