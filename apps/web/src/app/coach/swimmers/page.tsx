import type { Metadata } from "next";

import SiteFooter from "@/components/SiteFooter";
import SiteNav from "@/components/SiteNav";
import CoachRosterContent from "@/content/CoachRosterContent";
import { requireAuth } from "@/lib/requireAuth";
import { fetchCoachSwimmers } from "@/lib/api/coachSwimmers";

export const metadata: Metadata = {
  title: "Swimmers · Axiom Aquatics",
};

export default async function CoachSwimmersPage() {
  const auth = await requireAuth();
  if (!auth) return null;

  const swimmers = await fetchCoachSwimmers(auth.accessToken);

  return (
    <div className="flex flex-col min-h-screen">
      <SiteNav />
      <main className="flex-1 px-page py-16">
        <div className="mx-auto max-w-content">
          <h1 className="text-heading mb-6">Swimmers</h1>
          <CoachRosterContent swimmers={swimmers} />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
