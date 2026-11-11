import type { Metadata } from "next";

import CoachFamiliesContent from "@/content/CoachFamiliesContent";
import {
  fetchCoachFamilies,
  fetchCoachNeedsAttention,
} from "@/lib/api/coachHouseholds";
import { requireAuth } from "@/lib/requireAuth";

export const metadata: Metadata = {
  title: "Families · Axiom Aquatics",
};

export default async function CoachFamiliesPage() {
  const auth = await requireAuth();
  if (!auth) return null;

  const [familiesResult, needsAttentionResult] = await Promise.all([
    fetchCoachFamilies(auth.accessToken),
    fetchCoachNeedsAttention(auth.accessToken),
  ]);
  if (!familiesResult.ok) {
    throw new Error(`Failed to load families (${familiesResult.reason})`);
  }
  // Non-critical: if the attention list fetch fails we render the page
  // without the section. The per-family banner on each family page is
  // still live, so no refund ever goes un-surfaced.
  const initialNeedsAttention = needsAttentionResult.ok
    ? needsAttentionResult.data.jobs
    : [];

  return (
    <div className="flex flex-col flex-1 bg-background">
      <main id="main-content" className="flex-1">
        <div className="mx-auto max-w-content px-page pt-10 pb-tab-safe tablet:pt-14 tablet:pb-24">
          <CoachFamiliesContent
            families={familiesResult.data}
            initialNeedsAttention={initialNeedsAttention}
          />
        </div>
      </main>
    </div>
  );
}
