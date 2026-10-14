import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import type { SwimmerSkillsResponse } from "@swim-app/shared";

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
    if (swimmerResult.status === 403) redirect("/dashboard");
    throw new Error(`Failed to load swimmer (status ${swimmerResult.status})`);
  }

  const grades: SwimmerSkillsResponse["grades"] = skillsResult.ok ? skillsResult.data.grades : {};
  const startGrades: SwimmerSkillsResponse["startGrades"] = skillsResult.ok ? skillsResult.data.startGrades : {};
  const coachingPriorities: SwimmerSkillsResponse["coachingPriorities"] = skillsResult.ok ? skillsResult.data.coachingPriorities : [];
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
