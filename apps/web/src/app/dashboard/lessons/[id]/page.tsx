import { redirect } from "next/navigation";
import type { Metadata } from "next";

import type { UpcomingLesson } from "@swim-app/shared";

import { requireAuth } from "@/lib/requireAuth";
import { fetchHousehold } from "@/lib/api/households";
import { fetchBatchCancelableLessons, fetchLesson, fetchLocations } from "@/lib/api/lessons";
import LessonDetailContent from "@/content/LessonDetailContent";

export const metadata: Metadata = {
  title: "Lesson Details · Axiom Aquatics",
};

export default async function LessonDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireAuth();
  if (!auth) redirect("/login");
  const { accessToken } = auth;

  const [lesson, locations, household] = await Promise.all([
    fetchLesson(accessToken, id),
    fetchLocations(accessToken),
    fetchHousehold(accessToken),
  ]);

  if (!lesson) redirect("/dashboard");

  const isViewer = household?.myRole === "viewer";
  const isCoach = auth.profile.role === "coach";

  // When the lesson is part of a batch, load the exact set of lessons the
  // cancel-remaining DELETE endpoint would cancel so the confirm dialog
  // shows a 1:1 preview of what will be removed. Owners / managers only;
  // viewers and coaches never see the dialog.
  let batchSiblings: UpcomingLesson[] = [];
  if (lesson.batchId !== null && !isViewer && !isCoach) {
    batchSiblings = (await fetchBatchCancelableLessons(accessToken, lesson.batchId)) ?? [];
  }

  return (
    <LessonDetailContent
      lesson={lesson}
      locations={locations}
      isViewer={isViewer}
      isCoach={isCoach}
      batchSiblings={batchSiblings}
    />
  );
}
