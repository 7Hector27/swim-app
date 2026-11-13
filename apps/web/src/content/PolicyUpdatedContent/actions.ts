"use server";

import {
  PAYMENTS_REFUND_VERSION,
  PRIVACY_VERSION,
  TERMS_VERSION,
  type AcceptPoliciesResponse,
} from "@swim-app/shared";

import { createClient } from "@/lib/supabase/server";

export type AcceptPoliciesActionResult =
  | { status: "ok"; data: AcceptPoliciesResponse }
  | { status: "error" };

// Submits the current version for every tracked policy. The server
// validates each version against its current constant, so a client
// stuck on a stale build still fails loudly (422) rather than quietly
// writing a stale acceptance row.
export async function acceptPoliciesAction(): Promise<AcceptPoliciesActionResult> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { status: "error" };

  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/me/policies/accept`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          acceptances: [
            { policySlug: "terms", version: TERMS_VERSION },
            { policySlug: "privacy", version: PRIVACY_VERSION },
            { policySlug: "payments_refund", version: PAYMENTS_REFUND_VERSION },
          ],
        }),
      },
    );
    if (response.status !== 201) return { status: "error" };
    const json = (await response.json()) as AcceptPoliciesResponse;
    return { status: "ok", data: json };
  } catch {
    return { status: "error" };
  }
}
