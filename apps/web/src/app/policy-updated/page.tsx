import type { Metadata } from "next";
import { redirect } from "next/navigation";

import type { MissingPolicyAcceptancesResponse } from "@swim-app/shared";

import PolicyUpdatedContent from "@/content/PolicyUpdatedContent";
import { publicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "We've updated our policies · Axiom Aquatics",
};

// The interstitial a parent lands on when a gated write
// (POST /lessons, POST /lessons/batch, POST /payments/checkout-session)
// returned 409 policy_acceptance_required. The client caller's redirect
// carries the original path as `?next=`.
//
// If the caller somehow lands here without any stale policies — direct
// link, stale tab, race between accept + reload — bounce straight back
// to `?next=` (or /dashboard if that's missing/unsafe) so the parent
// doesn't see a stray "accept nothing" screen.
export default async function PolicyUpdatedPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const supabase = await createClient();
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) {
    redirect("/login");
  }

  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : "/dashboard";

  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/me/policies/missing`,
    {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    },
  );
  if (!response.ok) {
    redirect(next || "/dashboard");
  }
  const json = (await response.json()) as MissingPolicyAcceptancesResponse;
  if (json.missing.length === 0) {
    redirect(next || "/dashboard");
  }

  return (
    <PolicyUpdatedContent
      missing={json.missing}
      next={next}
      siteUrl={publicEnv.siteUrl}
    />
  );
}
