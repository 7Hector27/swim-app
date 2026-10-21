import type { Metadata } from "next";
import { redirect } from "next/navigation";

import ParentLessonsContent from "@/content/ParentLessonsContent";
import { requireAuth } from "@/lib/requireAuth";
import { fetchUpcomingLessons, fetchPastLessons } from "@/lib/api/lessons";

export const metadata: Metadata = { title: "Lessons · Axiom Aquatics" };

const PAGE_SIZE = 10;

export default async function ParentLessonsPage() {
  const auth = await requireAuth();
  if (!auth) redirect("/login");
  if (auth.profile.role !== "parent") redirect("/dashboard");

  const [upcomingRaw, past] = await Promise.all([
    fetchUpcomingLessons(auth.accessToken, { limit: PAGE_SIZE + 1 }),
    fetchPastLessons(auth.accessToken),
  ]);

  const initialHasMore = upcomingRaw.length > PAGE_SIZE;
  const initialLessons = initialHasMore ? upcomingRaw.slice(0, PAGE_SIZE) : upcomingRaw;

  return <ParentLessonsContent initialLessons={initialLessons} initialHasMore={initialHasMore} past={past} />;
}
