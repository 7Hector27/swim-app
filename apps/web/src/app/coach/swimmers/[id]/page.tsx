import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import type { GetEvaluationsItem, SwimmerSkillsResponse } from "@swim-app/shared";
import { DraftsListResponseSchema } from "@swim-app/shared";

import AccountInactiveScreen from "@/components/AccountInactiveScreen";
import CoachSwimmerDetailContent from "@/content/CoachSwimmerDetailContent";
import type { SectionResult } from "@/content/CoachSwimmerDetailContent/CoachSwimmerDetailContent";
import { requireAuth } from "@/lib/requireAuth";
import { fetchCoachSwimmerDetail, fetchSwimmerTimeline } from "@/lib/api/coachSwimmers";
import {
  fetchGolfScoreTrends,
  fetchSkillCategories,
  fetchSwimmerEvaluations,
  fetchSwimmerSkills,
} from "@/lib/api/evaluations";
import { fetchSwimmerMeetSwims, fetchMeets } from "@/lib/api/meets";

export const metadata: Metadata = {
  title: "Swimmer · Axiom Aquatics",
};

interface CoachSwimmerPageProps {
  params: Promise<{ id: string }>;
}

export default async function CoachSwimmerPage({ params }: CoachSwimmerPageProps) {
  const [auth, { id }] = await Promise.all([requireAuth(), params]);
  if (!auth) return <AccountInactiveScreen />;

  const [
    swimmerResult,
    skillsResult,
    categoriesResult,
    timelineResult,
    swimsResult,
    meetsResult,
    draftsRes,
    golfScoreTrendsResult,
    evaluationsResult,
  ] = await Promise.all([
    fetchCoachSwimmerDetail(id, auth.accessToken),
    fetchSwimmerSkills(id, auth.accessToken),
    fetchSkillCategories(auth.accessToken),
    fetchSwimmerTimeline(id, auth.accessToken),
    fetchSwimmerMeetSwims(id, auth.accessToken),
    fetchMeets(auth.accessToken),
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/coach/swimmers/${id}/drafts`, {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
      cache: "no-store",
    }),
    fetchGolfScoreTrends(id, auth.accessToken),
    // Only need the top 5 for the detail page's Evaluations section.
    fetchSwimmerEvaluations(id, auth.accessToken, { limit: 5 }),
  ]);

  if (!swimmerResult.ok) {
    if (swimmerResult.status === 404) notFound();
    if (swimmerResult.status === 403) redirect("/dashboard");
    throw new Error(`Failed to load swimmer (status ${swimmerResult.status})`);
  }

  const grades: SwimmerSkillsResponse["grades"] = skillsResult.ok ? skillsResult.data.grades : {};
  const startGrades: SwimmerSkillsResponse["startGrades"] = skillsResult.ok ? skillsResult.data.startGrades : {};
  const coachingPriorities: SwimmerSkillsResponse["coachingPriorities"] = skillsResult.ok ? skillsResult.data.coachingPriorities : [];
  const categories = categoriesResult.ok ? categoriesResult.categories : [];
  const timelineItems = timelineResult.ok ? timelineResult.items : [];
  const swims = swimsResult.ok ? swimsResult.data.swims : [];
  const personalBests = swimsResult.ok ? swimsResult.data.personalBests : [];
  const meets = meetsResult.ok ? meetsResult.meets : [];
  const parsed = DraftsListResponseSchema.safeParse(draftsRes.ok ? await draftsRes.json().catch(() => null) : null);
  const swimmerDrafts = parsed.success ? parsed.data.drafts : [];
  const golfScoreTrends = golfScoreTrendsResult.ok ? golfScoreTrendsResult.data.trends : [];
  // Thread the result all the way to the content so a server error renders
  // an inline retry instead of the "No evaluations yet" empty-state copy.
  const evaluationsSection: SectionResult<GetEvaluationsItem[]> = evaluationsResult.ok
    ? { ok: true, data: evaluationsResult.data.evaluations }
    : { ok: false };

  return (
    <CoachSwimmerDetailContent
      swimmer={swimmerResult.swimmer}
      grades={grades}
      startGrades={startGrades}
      coachingPriorities={coachingPriorities}
      categories={categories}
      timelineItems={timelineItems}
      swims={swims}
      personalBests={personalBests}
      meets={meets}
      drafts={swimmerDrafts}
      golfScoreTrends={golfScoreTrends}
      evaluationsResult={evaluationsSection}
    />
  );
}
