import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import AccountInactiveScreen from "@/components/AccountInactiveScreen";
import CoachRescheduleContent from "@/content/CoachRescheduleContent";
import { requireAuth } from "@/lib/requireAuth";
import { fetchCoachLesson, fetchLocations } from "@/lib/api/lessons";

export const metadata: Metadata = {
  title: "Reschedule · Axiom Aquatics",
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function CoachLessonReschedulePage({ params }: PageProps) {
  const [auth, { id }] = await Promise.all([requireAuth(), params]);
  if (!auth) return <AccountInactiveScreen />;
  if (auth.profile.role !== "coach") redirect("/dashboard");

  const [lessonResult, locationsResult] = await Promise.all([
    fetchCoachLesson(auth.accessToken, id),
    fetchLocations(auth.accessToken),
  ]);

  if (!lessonResult.ok) {
    if (lessonResult.status === 404) notFound();
    throw new Error(`Failed to load lesson (status ${lessonResult.status})`);
  }

  // Write page — the reschedule form needs the pools list. Throw so the route
  // error boundary renders instead of a form that can't submit.
  if (!locationsResult.ok) {
    throw new Error(`Failed to load locations (${locationsResult.reason})`);
  }

  if (lessonResult.lesson.status !== "pending" && lessonResult.lesson.status !== "approved") {
    redirect(`/coach/lessons/${id}`);
  }

  return <CoachRescheduleContent lesson={lessonResult.lesson} locations={locationsResult.data} />;
}
