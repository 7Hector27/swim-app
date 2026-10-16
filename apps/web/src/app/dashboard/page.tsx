import type { Metadata } from "next";
import { redirect } from "next/navigation";

import CoachDashboardContent from "@/content/CoachDashboardContent";
import ParentDashboardContent from "@/content/ParentDashboardContent";
import { requireAuth } from "@/lib/requireAuth";

export const metadata: Metadata = {
  title: "Dashboard · Axiom Aquatics",
};

interface Props {
  searchParams: Promise<{ booked?: string; rescheduled?: string; from?: string }>;
}

export default async function DashboardPage({ searchParams }: Props) {
  const auth = await requireAuth();
  if (!auth) redirect("/login");

  const { profile, accessToken } = auth;

  if (profile.role === "coach") {
    return <CoachDashboardContent accessToken={accessToken} />;
  }

  const { booked, rescheduled, from: rescheduledFrom } = await searchParams;

  return (
    <ParentDashboardContent
      profile={profile}
      accessToken={accessToken}
      {...(booked !== undefined && { bookedLessonId: booked })}
      {...(rescheduled !== undefined && { rescheduledLessonId: rescheduled, rescheduledFrom })}
    />
  );
}
