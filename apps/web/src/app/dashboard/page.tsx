import type { Metadata } from "next";
import { redirect } from "next/navigation";

import CoachDashboardContent from "@/content/CoachDashboardContent";
import ParentDashboardContent from "@/content/ParentDashboardContent";
import { fetchMe } from "@/lib/api/me";

export const metadata: Metadata = {
  title: "Dashboard · JG Swim",
};

export default async function DashboardPage() {
  const result = await fetchMe();
  if (!result.ok) redirect("/login");

  const { profile } = result;

  if (profile.role === "coach") {
    return <CoachDashboardContent profile={profile} />;
  }

  return <ParentDashboardContent profile={profile} />;
}
