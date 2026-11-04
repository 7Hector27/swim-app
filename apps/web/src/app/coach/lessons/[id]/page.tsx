import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import AccountInactiveScreen from "@/components/AccountInactiveScreen";
import CoachLessonDetailContent from "@/content/CoachLessonDetailContent";
import { requireAuth } from "@/lib/requireAuth";
import { fetchCoachLesson, fetchLessonNotes } from "@/lib/api/lessons";

export const metadata: Metadata = {
  title: "Lesson · Axiom Aquatics",
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function CoachLessonPage({ params }: PageProps) {
  const [auth, { id }] = await Promise.all([requireAuth(), params]);
  if (!auth) return <AccountInactiveScreen />;
  if (auth.profile.role !== "coach") redirect("/dashboard");

  const lessonResult = await fetchCoachLesson(auth.accessToken, id);
  if (!lessonResult.ok) {
    if (lessonResult.status === 404) notFound();
    throw new Error(`Failed to load lesson (status ${lessonResult.status})`);
  }
  const notes = await fetchLessonNotes(auth.accessToken, id);

  return <CoachLessonDetailContent lesson={lessonResult.lesson} notes={notes} />;
}
