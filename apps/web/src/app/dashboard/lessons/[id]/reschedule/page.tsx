import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { requireAuth } from "@/lib/requireAuth";
import { fetchHousehold } from "@/lib/api/households";
import { fetchLesson, fetchLocations } from "@/lib/api/lessons";
import RescheduleContent from "@/content/RescheduleContent";

export const metadata: Metadata = {
  title: "Reschedule · Axiom Aquatics",
};

export default async function ReschedulePage({ params }: { params: Promise<{ id: string }> }) {
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
  const lessonHasStarted = new Date() >= new Date(lesson.startsAt);

  if (isViewer || lessonHasStarted) redirect(`/dashboard/lessons/${id}`);

  return <RescheduleContent lesson={lesson} locations={locations} />;
}
