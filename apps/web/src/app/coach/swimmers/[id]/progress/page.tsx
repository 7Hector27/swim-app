import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import AccountInactiveScreen from "@/components/AccountInactiveScreen";
import SwimmerProgressContent from "@/content/SwimmerProgressContent";
import { requireAuth } from "@/lib/requireAuth";
import { fetchCoachSwimmerDetail } from "@/lib/api/coachSwimmers";
import {
  fetchGolfScoreTrends,
  fetchScoreHistory,
  fetchSkillCategories,
  fetchSwimmerProgress,
} from "@/lib/api/evaluations";

export const metadata: Metadata = {
  title: "Progress · Axiom Aquatics",
};

interface ProgressPageProps {
  params: Promise<{ id: string }>;
}

export default async function SwimmerProgressPage({ params }: ProgressPageProps) {
  const [auth, { id }] = await Promise.all([requireAuth(), params]);
  if (!auth) return <AccountInactiveScreen />;

  const [swimmerResult, progressResult, categoriesResult, scoreHistoryResult, golfScoreResult] =
    await Promise.all([
      fetchCoachSwimmerDetail(id, auth.accessToken),
      fetchSwimmerProgress(id, auth.accessToken),
      fetchSkillCategories(auth.accessToken),
      fetchScoreHistory(id, auth.accessToken),
      fetchGolfScoreTrends(id, auth.accessToken),
    ]);

  if (!swimmerResult.ok) {
    if (swimmerResult.status === 404) notFound();
    if (swimmerResult.status === 403) redirect("/dashboard");
    throw new Error(`Failed to load swimmer (status ${swimmerResult.status})`);
  }

  if (!progressResult.ok) {
    if (progressResult.status === 404) notFound();
    if (progressResult.status === 403) redirect("/dashboard");
    throw new Error(`Failed to load progress (status ${progressResult.status})`);
  }

  const categories = categoriesResult.ok ? categoriesResult.categories : [];
  // Charts gracefully degrade when score-history or golf-score fail: the
  // page still renders with the per-skill list and the empty charts fall back
  // to their own "not enough data" copy.
  const scoreHistory = scoreHistoryResult.ok
    ? scoreHistoryResult.data
    : {
        points: [],
        recentChanges: [],
        milestones: [],
        faultTrends: [],
        measurements: [],
      };
  const golfScore = golfScoreResult.ok ? golfScoreResult.data : { trends: [] };

  // Pin "now" on the server so recency text ("Rated 3 days ago") renders
  // identically during SSR and client hydration — without this, the server
  // and the client each call `new Date()` and may land on different day
  // counts near midnight.
  const nowIso = new Date().toISOString();

  return (
    <SwimmerProgressContent
      swimmer={swimmerResult.swimmer}
      progress={progressResult.data}
      categories={categories}
      scoreHistory={scoreHistory}
      golfScore={golfScore}
      nowIso={nowIso}
      sectionFailures={{
        categories: !categoriesResult.ok,
        scoreHistory: !scoreHistoryResult.ok,
        golfScore: !golfScoreResult.ok,
      }}
    />
  );
}
