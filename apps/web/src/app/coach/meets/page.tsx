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
  const meets = result.ok ? result.meets : [];

  return <CoachMeetsContent meets={meets} />;
}
