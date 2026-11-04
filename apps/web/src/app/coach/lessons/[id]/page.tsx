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
  // Notes are secondary — the lesson detail is the primary data. Pass as a
  // SectionResult so the content component renders InlineError when the load
  // fails, instead of collapsing to an empty notes list.
  const notesResult = await fetchLessonNotes(auth.accessToken, id);
  const notes = notesResult.ok ? { ok: true as const, data: notesResult.data } : { ok: false as const };

  return <CoachLessonDetailContent lesson={lessonResult.lesson} notes={notes} />;
}
