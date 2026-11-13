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
  searchParams: Promise<{ action?: string }>;
}

export default async function CoachLessonPage({ params, searchParams }: PageProps) {
  const [auth, { id }, { action }] = await Promise.all([requireAuth(), params, searchParams]);
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

  // ADR 036 Phase 8 Part B Stop 3 piece 12 (animation audit #3): the
  // approve / decline / no-show server actions redirect back to this
  // page with ?action=<kind>. Normalize + thread the toast prop so
  // the content component fires its one-shot bottom-anchored
  // confirmation toast after the page lands. Unknown values are
  // ignored so a stray URL param can't surface a bogus toast.
  const toastAction: "approved" | "declined" | "no_show" | undefined =
    action === "approved" || action === "declined" || action === "no_show"
      ? action
      : undefined;

  return (
    <CoachLessonDetailContent
      lesson={lessonResult.lesson}
      notes={notes}
      {...(toastAction !== undefined && { toastAction })}
    />
  );
}
