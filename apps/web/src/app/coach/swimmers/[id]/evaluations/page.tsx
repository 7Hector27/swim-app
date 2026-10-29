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

  // Degrade to an empty list on a transient failure. The Load more button
  // only renders when there's a cursor to follow, so a bad initial fetch
  // leaves the page functional but empty.
  const initialEvaluations = evaluationsResult.ok ? evaluationsResult.data.evaluations : [];
  const initialNextCursor = evaluationsResult.ok ? evaluationsResult.data.nextCursor : null;

  return (
    <CoachEvaluationsContent
      swimmer={swimmerResult.swimmer}
      accessToken={auth.accessToken}
      initialEvaluations={initialEvaluations}
      initialNextCursor={initialNextCursor}
    />
  );
}
