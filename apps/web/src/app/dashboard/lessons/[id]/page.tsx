import { redirect } from "next/navigation";
import type { Metadata } from "next";

import type { UpcomingLesson } from "@swim-app/shared";

import { requireAuth } from "@/lib/requireAuth";
import { fetchHousehold } from "@/lib/api/households";
import { fetchLesson, fetchLocations, fetchUpcomingLessons } from "@/lib/api/lessons";
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

  // When the lesson is part of a batch, load the siblings so the cancel-
  // remaining confirm dialog can list exactly what will be cancelled. The
  // list only matters for parent owners/managers on a future-dated lesson;
  // for other viewers we skip the extra fetch.
  let batchSiblings: UpcomingLesson[] = [];
  if (lesson.batchId !== null && !isViewer && !isCoach) {
    const upcoming = (await fetchUpcomingLessons(accessToken, { limit: 50 })) ?? [];
    batchSiblings = upcoming.filter((item) => item.batchId === lesson.batchId);
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
