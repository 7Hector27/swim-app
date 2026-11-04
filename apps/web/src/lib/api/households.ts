import { cache } from "react";

import { HouseholdResponseSchema, ListInviteResponseSchema, type HouseholdResponse, type PendingInvite } from "@swim-app/shared";

// Discriminates "parent has no household yet" (403 from the API, which is
// how `requireHouseholdMember` signals unenrolled parents) from a load
// failure. Callers that redirect-to-onboarding must only do so for
// household === null — a load failure must surface through the error path.
export type FetchHouseholdResult =
  | { ok: true; household: HouseholdResponse | null }
  | { ok: false; status: number };

export const fetchHousehold = cache(async function fetchHousehold(
  accessToken: string,
): Promise<FetchHouseholdResult> {
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/households/mine`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    // 403 = unenrolled parent (legitimate "no household" state).
    // 404 = household record missing — treated the same (no household to show).
    if (response.status === 403 || response.status === 404) {
      return { ok: true, household: null };
    }
    if (!response.ok) return { ok: false, status: response.status };
    const body: unknown = await response.json();
    const parsed = HouseholdResponseSchema.safeParse(body);
    if (!parsed.success) return { ok: false, status: 500 };
    return { ok: true, household: parsed.data };
  } catch {
    return { ok: false, status: 0 };
  }
});

export async function fetchPendingInvite(accessToken: string): Promise<PendingInvite | null> {
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/households/mine/invites`, {
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
