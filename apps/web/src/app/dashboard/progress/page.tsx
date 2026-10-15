import type { Metadata } from "next";
import { redirect } from "next/navigation";

import ParentProgressContent from "@/content/ParentProgressContent";
import { requireAuth } from "@/lib/requireAuth";
import { fetchSwimmers } from "@/lib/api/swimmers";

export const metadata: Metadata = { title: "Progress · Axiom Aquatics" };

export default async function ParentProgressPage() {
  const auth = await requireAuth();
  if (!auth) redirect("/login");
  if (auth.profile.role !== "parent") redirect("/dashboard");

  const swimmers = await fetchSwimmers(auth.accessToken);

  if (swimmers.length === 0) redirect("/dashboard");

  const firstSwimmer = swimmers[0];
  if (swimmers.length === 1 && firstSwimmer) {
    redirect(`/dashboard/swimmers/${firstSwimmer.id}/progress`);
  }

  return <ParentProgressContent swimmers={swimmers} />;
}
