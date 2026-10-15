import type { Metadata } from "next";
import { redirect } from "next/navigation";

import ParentLessonsContent from "@/content/ParentLessonsContent";
import { requireAuth } from "@/lib/requireAuth";
import { fetchUpcomingLessons, fetchPastLessons } from "@/lib/api/lessons";

export const metadata: Metadata = { title: "Lessons · Axiom Aquatics" };

export default async function ParentLessonsPage() {
  const auth = await requireAuth();
  if (!auth) redirect("/login");
  if (auth.profile.role !== "parent") redirect("/dashboard");

  const [upcoming, past] = await Promise.all([
    fetchUpcomingLessons(auth.accessToken),
    fetchPastLessons(auth.accessToken),
  ]);

  return <ParentLessonsContent upcoming={upcoming} past={past} />;
}
