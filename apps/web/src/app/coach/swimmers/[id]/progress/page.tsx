import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import AccountInactiveScreen from "@/components/AccountInactiveScreen";
import SwimmerProgressContent from "@/content/SwimmerProgressContent";
import { requireAuth } from "@/lib/requireAuth";
import { fetchCoachSwimmerDetail } from "@/lib/api/coachSwimmers";
import { fetchSwimmerProgress, fetchSkillCategories } from "@/lib/api/evaluations";

export const metadata: Metadata = {
  title: "Progress · Axiom Aquatics",
};

interface ProgressPageProps {
  params: Promise<{ id: string }>;
}

export default async function SwimmerProgressPage({ params }: ProgressPageProps) {
  const [auth, { id }] = await Promise.all([requireAuth(), params]);
  if (!auth) return <AccountInactiveScreen />;

  const [swimmerResult, progressResult, categoriesResult] = await Promise.all([
    fetchCoachSwimmerDetail(id, auth.accessToken),
    fetchSwimmerProgress(id, auth.accessToken),
    fetchSkillCategories(auth.accessToken),
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

  return (
    <SwimmerProgressContent
      swimmer={swimmerResult.swimmer}
      progress={progressResult.data}
      categories={categories}
    />
  );
}
