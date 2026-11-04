import type { Metadata } from "next";

import AccountInactiveScreen from "@/components/AccountInactiveScreen";
import CoachMeetsContent from "@/content/CoachMeetsContent";
import { requireAuth } from "@/lib/requireAuth";
import { fetchMeets } from "@/lib/api/meets";

export const metadata: Metadata = {
  title: "Meets · Axiom Aquatics",
};

export default async function CoachMeetsPage() {
  const auth = await requireAuth();
  if (!auth) return <AccountInactiveScreen />;

  const result = await fetchMeets(auth.accessToken);
  if (!result.ok) {
    throw new Error(`Failed to load meets (status ${result.status})`);
  }

  return <CoachMeetsContent meets={result.meets} />;
}
