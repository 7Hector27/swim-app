import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { requireAuth } from "@/lib/requireAuth";
import { fetchHousehold } from "@/lib/api/households";
import { fetchLesson, fetchLocations } from "@/lib/api/lessons";
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

  return <LessonDetailContent lesson={lesson} locations={locations} isViewer={isViewer} />;
}
