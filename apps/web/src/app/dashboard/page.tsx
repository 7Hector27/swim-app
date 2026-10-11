import type { Metadata } from "next";
import { redirect } from "next/navigation";

import CoachDashboardContent from "@/content/CoachDashboardContent";
import ParentDashboardContent from "@/content/ParentDashboardContent";
import { requireAuth } from "@/lib/requireAuth";

export const metadata: Metadata = {
  title: "Dashboard · Axiom Aquatics",
};

export default async function DashboardPage() {
  const auth = await requireAuth();
  if (!auth) redirect("/login");

  const { profile, accessToken } = auth;

  if (profile.role === "coach") {
    return <CoachDashboardContent profile={profile} accessToken={accessToken} />;
  }

  return <ParentDashboardContent profile={profile} accessToken={accessToken} />;
}
