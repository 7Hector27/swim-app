import type { Metadata } from "next";
import { notFound } from "next/navigation";

import AccountInactiveScreen from "@/components/AccountInactiveScreen";
import CoachSwimmerDetailContent from "@/content/CoachSwimmerDetailContent";
import { requireAuth } from "@/lib/requireAuth";
import { fetchCoachSwimmerDetail } from "@/lib/api/coachSwimmers";

export const metadata: Metadata = {
  title: "Swimmer · Axiom Aquatics",
};

interface CoachSwimmerPageProps {
  params: Promise<{ id: string }>;
}

export default async function CoachSwimmerPage({ params }: CoachSwimmerPageProps) {
  const [auth, { id }] = await Promise.all([requireAuth(), params]);
  if (!auth) return <AccountInactiveScreen />;

  const result = await fetchCoachSwimmerDetail(id, auth.accessToken);
  if (!result.ok) {
    if (result.status === 404) notFound();
    throw new Error(`Failed to load swimmer (status ${result.status})`);
  }

  return <CoachSwimmerDetailContent swimmer={result.swimmer} />;
}
