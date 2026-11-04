import type { Metadata } from "next";
import { redirect } from "next/navigation";

import HouseholdSettingsContent from "@/content/HouseholdSettingsContent";
import { fetchHousehold, fetchPendingInvite } from "@/lib/api/households";
import { requireAuth } from "@/lib/requireAuth";

export const metadata: Metadata = {
  title: "Household · Axiom Aquatics",
};

export default async function HouseholdPage() {
  const auth = await requireAuth();
  if (!auth) return null;

  const [householdResult, pendingInvite] = await Promise.all([
    fetchHousehold(auth.accessToken),
    fetchPendingInvite(auth.accessToken),
  ]);

  // A failed load must never fall through to the onboarding / redirect
  // path — the user would see "we're setting you up" when the server is
  // actually broken. Throw so the parent error boundary renders.
  if (!householdResult.ok) {
    throw new Error(`Failed to load household (status ${householdResult.status})`);
  }
  if (householdResult.household === null) redirect("/dashboard");

  return (
    <HouseholdSettingsContent
      household={householdResult.household}
      pendingInvite={pendingInvite}
      accessToken={auth.accessToken}
    />
  );
}
