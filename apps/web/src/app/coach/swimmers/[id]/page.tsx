import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { StartGradeResult } from "@swim-app/shared";

import AccountInactiveScreen from "@/components/AccountInactiveScreen";
import CoachSwimmerDetailContent from "@/content/CoachSwimmerDetailContent";
import { requireAuth } from "@/lib/requireAuth";
import { fetchCoachSwimmerDetail } from "@/lib/api/coachSwimmers";
import { fetchSwimmerSkills, fetchSkillCategories } from "@/lib/api/evaluations";

export const metadata: Metadata = {
  title: "Swimmer · Axiom Aquatics",
};

interface CoachSwimmerPageProps {
  params: Promise<{ id: string }>;
}

export default async function CoachSwimmerPage({ params }: CoachSwimmerPageProps) {
  const [auth, { id }] = await Promise.all([requireAuth(), params]);
  if (!auth) return <AccountInactiveScreen />;

  const [swimmerResult, skillsResult, categoriesResult] = await Promise.all([
    fetchCoachSwimmerDetail(id, auth.accessToken),
    fetchSwimmerSkills(id, auth.accessToken),
    fetchSkillCategories(auth.accessToken),
  ]);

  if (!swimmerResult.ok) {
    if (swimmerResult.status === 404) notFound();
    throw new Error(`Failed to load swimmer (status ${swimmerResult.status})`);
  }

  const grades: Record<string, number | "not_legal" | "no_concept"> = skillsResult.ok ? skillsResult.data.grades : {};
  const startGrades: Record<string, StartGradeResult> = skillsResult.ok ? skillsResult.data.startGrades : {};
  const coachingPriorities: Array<{ targetSlug: string; chain: Array<{ slug: string }> }> = skillsResult.ok ? skillsResult.data.coachingPriorities : [];
  const categories = categoriesResult.ok ? categoriesResult.categories : [];

  return (
    <CoachSwimmerDetailContent
      swimmer={swimmerResult.swimmer}
      accessToken={auth.accessToken}
      grades={grades}
      startGrades={startGrades}
      coachingPriorities={coachingPriorities}
      categories={categories}
    />
  );
}
