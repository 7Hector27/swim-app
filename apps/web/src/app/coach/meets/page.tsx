import type { Metadata } from "next";

import CoachMeetsContent from "@/content/CoachMeetsContent";
import { requireAuth } from "@/lib/requireAuth";
import { fetchMeets } from "@/lib/api/meets";

export const metadata: Metadata = {
  title: "Meets · Axiom Aquatics",
};

export default async function CoachMeetsPage() {
  const auth = await requireAuth();
  if (!auth) return null;

  const meetsResult = await fetchMeets(auth.accessToken);
  if (!meetsResult.ok) {
    throw new Error(`Failed to load meets (${meetsResult.status})`);
  }

  return <CoachMeetsContent meets={meetsResult.meets} />;
}
