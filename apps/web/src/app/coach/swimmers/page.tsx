import type { Metadata } from "next";

import CoachRosterContent from "@/content/CoachRosterContent";
import { requireAuth } from "@/lib/requireAuth";
import { fetchCoachSwimmers } from "@/lib/api/coachSwimmers";

export const metadata: Metadata = {
  title: "Swimmers · Axiom Aquatics",
};

export default async function CoachSwimmersPage() {
  const auth = await requireAuth();
  if (!auth) return null;

  // Primary — this page IS the swimmer roster. Throw on load failure.
  const swimmersResult = await fetchCoachSwimmers(auth.accessToken);
  if (!swimmersResult.ok) {
    throw new Error(`Failed to load swimmers (${swimmersResult.reason})`);
  }

  return (
    <div className="flex flex-col flex-1">
      <main className="flex-1 px-page py-16">
        <div className="mx-auto max-w-content">
          <h1 className="text-heading mb-6">Swimmers</h1>
          <CoachRosterContent swimmers={swimmersResult.data} />
        </div>
      </main>
    </div>
  );
}
