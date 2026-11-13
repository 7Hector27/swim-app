import type { Metadata } from "next";

import CoachRosterContent from "@/content/CoachRosterContent";
import { requireAuth } from "@/lib/requireAuth";
import { fetchCoachSwimmers } from "@/lib/api/coachSwimmers";
import { fetchMeets } from "@/lib/api/meets";

export const metadata: Metadata = {
  title: "Swimmers · Axiom Aquatics",
};

// ADR 036 Phase 8 Part B Stop 3 piece 6: the Swimmers page hosts a
// Meets tab. `?tab=meets` deep-links straight into it (used by the
// /coach/meets → /coach/swimmers?tab=meets redirect) so old links
// land on the right tab without a client-side flash.
export default async function CoachSwimmersPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const auth = await requireAuth();
  if (!auth) return null;

  const { tab } = await searchParams;
  const initialTab = tab === "meets" ? "meets" : "swimmers";

  const [swimmersResult, meetsResult] = await Promise.all([
    fetchCoachSwimmers(auth.accessToken),
    fetchMeets(auth.accessToken),
  ]);

  // Primary — this page IS the swimmer roster. Throw on load failure.
  if (!swimmersResult.ok) {
    throw new Error(`Failed to load swimmers (${swimmersResult.reason})`);
  }
  // Meets is the secondary tab; fall back to an empty list on failure
  // so the Swimmers tab still renders. The user can retry by reloading.
  const meets = meetsResult.ok ? meetsResult.meets : [];

  return (
    <div className="flex flex-col flex-1">
      <main className="flex-1 px-page py-16">
        <div className="mx-auto max-w-content">
          <h1 className="text-heading mb-6">Swimmers</h1>
          <CoachRosterContent
            swimmers={swimmersResult.data}
            meets={meets}
            initialTab={initialTab}
          />
        </div>
      </main>
    </div>
  );
}
