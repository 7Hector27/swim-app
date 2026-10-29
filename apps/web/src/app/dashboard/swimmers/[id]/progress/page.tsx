import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import AccountInactiveScreen from "@/components/AccountInactiveScreen";
import ParentSwimmerProgressContent from "@/content/ParentSwimmerProgressContent";
import { requireAuth } from "@/lib/requireAuth";
import {
  fetchParentScoreHistory,
  fetchParentSwimmer,
  fetchParentSwimmerProgress,
} from "@/lib/api/parentProgress";
import { fetchSkillCategories } from "@/lib/api/evaluations";

export const metadata: Metadata = {
  title: "Progress · Axiom Aquatics",
};

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ParentSwimmerProgressPage({ params }: Props) {
  const [auth, { id }] = await Promise.all([requireAuth(), params]);
  if (!auth) return <AccountInactiveScreen />;

  // Coaches have their own progress route
  if (auth.profile.role === "coach") {
    redirect(`/coach/swimmers/${id}/progress`);
  }

  const [swimmerResult, progressResult, categoriesResult, scoreHistoryResult] =
    await Promise.all([
      fetchParentSwimmer(id, auth.accessToken),
      fetchParentSwimmerProgress(id, auth.accessToken),
      fetchSkillCategories(auth.accessToken),
      fetchParentScoreHistory(id, auth.accessToken),
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
  // Charts gracefully degrade when score-history fails: the page still renders
  // without them (same pattern as the coach progress page).
  const scoreHistory = scoreHistoryResult.ok
    ? scoreHistoryResult.data
    : { points: [], recentChanges: [], milestones: [] };

  return (
    <ParentSwimmerProgressContent
      swimmer={swimmerResult.swimmer}
      progress={progressResult.data}
      categories={categories}
      scoreHistory={scoreHistory}
    />
  );
}
