import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import AccountInactiveScreen from "@/components/AccountInactiveScreen";
import CoachEvaluationsContent from "@/content/CoachEvaluationsContent";
import { requireAuth } from "@/lib/requireAuth";
import { fetchCoachSwimmerDetail } from "@/lib/api/coachSwimmers";
import { fetchSwimmerEvaluations } from "@/lib/api/evaluations";

export const metadata: Metadata = {
  title: "Evaluations · Axiom Aquatics",
};

interface Props {
  params: Promise<{ id: string }>;
}

export default async function CoachSwimmerEvaluationsPage({ params }: Props) {
  const [auth, { id }] = await Promise.all([requireAuth(), params]);
  if (!auth) return <AccountInactiveScreen />;

  if (auth.profile.role !== "coach") redirect("/dashboard");

  const [swimmerResult, evaluationsResult] = await Promise.all([
    fetchCoachSwimmerDetail(id, auth.accessToken),
    fetchSwimmerEvaluations(id, auth.accessToken, { limit: 20 }),
  ]);

  if (!swimmerResult.ok) {
    if (swimmerResult.status === 404) notFound();
    if (swimmerResult.status === 403) redirect("/dashboard");
    throw new Error(`Failed to load swimmer (status ${swimmerResult.status})`);
  }

  // Evaluations IS this page's primary data. Throw so the route error
  // boundary renders instead of showing an empty list identical to the
  // "no evaluations yet" state.
  if (!evaluationsResult.ok) {
    throw new Error(`Failed to load evaluations (status ${evaluationsResult.status})`);
  }

  return (
    <CoachEvaluationsContent
      swimmer={swimmerResult.swimmer}
      accessToken={auth.accessToken}
      initialEvaluations={evaluationsResult.data.evaluations}
      initialNextCursor={evaluationsResult.data.nextCursor}
    />
  );
}
