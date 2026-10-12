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

  const [household, pendingInvite] = await Promise.all([
    fetchHousehold(auth.accessToken),
    fetchPendingInvite(auth.accessToken),
  ]);

  if (!household) redirect("/dashboard");

  return (
    <HouseholdSettingsContent
      household={household}
      pendingInvite={pendingInvite}
      accessToken={auth.accessToken}
    />
  );
}
