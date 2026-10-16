import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import AccountInactiveScreen from "@/components/AccountInactiveScreen";
import EvaluateContent from "@/content/EvaluateContent";
import { requireAuth } from "@/lib/requireAuth";
import { fetchCoachSwimmerDetail } from "@/lib/api/coachSwimmers";
import { fetchScreens } from "@/lib/api/evaluations";

export const metadata: Metadata = {
  title: "Evaluate · Axiom Aquatics",
};

interface EvaluatePageProps {
  params: Promise<{ id: string }>;
}

export default async function EvaluatePage({ params }: EvaluatePageProps) {
  const [auth, { id }] = await Promise.all([requireAuth(), params]);
  if (!auth) return <AccountInactiveScreen />;

  const [swimmerResult, screensResult] = await Promise.all([
    fetchCoachSwimmerDetail(id, auth.accessToken),
    fetchScreens(auth.accessToken),
  ]);

  if (!swimmerResult.ok) {
    if (swimmerResult.status === 404) notFound();
    if (swimmerResult.status === 403) redirect("/dashboard");
    throw new Error(`Failed to load swimmer (status ${swimmerResult.status})`);
  }
  if (!screensResult.ok) {
    throw new Error(`Failed to load screens (status ${screensResult.status})`);
  }

  return (
    <EvaluateContent
      swimmer={swimmerResult.swimmer}
      screens={screensResult.screens}
      accessToken={auth.accessToken}
    />
  );
}
