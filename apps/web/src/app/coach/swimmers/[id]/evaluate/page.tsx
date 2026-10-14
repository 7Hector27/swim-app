import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import AccountInactiveScreen from "@/components/AccountInactiveScreen";
import EvaluateContent from "@/content/EvaluateContent";
import { requireAuth } from "@/lib/requireAuth";
import { fetchCoachSwimmerDetail } from "@/lib/api/coachSwimmers";
import { fetchSkillCategories } from "@/lib/api/evaluations";

export const metadata: Metadata = {
  title: "Evaluate · Axiom Aquatics",
};

interface EvaluatePageProps {
  params: Promise<{ id: string }>;
}

export default async function EvaluatePage({ params }: EvaluatePageProps) {
  const [auth, { id }] = await Promise.all([requireAuth(), params]);
  if (!auth) return <AccountInactiveScreen />;
  if (auth.profile.role !== "coach") {
    redirect("/dashboard");
  }

  const [swimmerResult, categoriesResult] = await Promise.all([
    fetchCoachSwimmerDetail(id, auth.accessToken),
    fetchSkillCategories(auth.accessToken),
  ]);

  if (!swimmerResult.ok) {
    if (swimmerResult.status === 404) notFound();
    throw new Error(`Failed to load swimmer (status ${swimmerResult.status})`);
  }
  if (!categoriesResult.ok) {
    throw new Error(`Failed to load skill categories (status ${categoriesResult.status})`);
  }

  return (
    <EvaluateContent
      swimmer={swimmerResult.swimmer}
      categories={categoriesResult.categories}
      accessToken={auth.accessToken}
    />
  );
}
