import type { Metadata } from "next";
import { redirect } from "next/navigation";

import ParentLessonsContent from "@/content/ParentLessonsContent";
import { requireAuth } from "@/lib/requireAuth";
import { fetchUpcomingLessons, fetchPastLessons } from "@/lib/api/lessons";
import { PAGE_SIZE } from "@/content/ParentLessonsContent/constants";

export const metadata: Metadata = { title: "Lessons · Axiom Aquatics" };

export default async function ParentLessonsPage() {
  const auth = await requireAuth();
  if (!auth) redirect("/login");
  if (auth.profile.role !== "parent") redirect("/dashboard");

  const [upcomingResult, pastResult] = await Promise.all([
    fetchUpcomingLessons(auth.accessToken, { limit: PAGE_SIZE + 1 }),
    fetchPastLessons(auth.accessToken),
  ]);

  // Primary — the lessons page is the lessons list. If either load fails,
  // throw so the route error boundary renders rather than a half-empty page.
  if (!upcomingResult.ok) {
    throw new Error(`Failed to load upcoming lessons (${upcomingResult.reason})`);
  }
  if (!pastResult.ok) {
    throw new Error(`Failed to load past lessons (${pastResult.reason})`);
  }

  const upcomingItems = upcomingResult.data.items;
  const initialHasMore = upcomingItems.length > PAGE_SIZE;
  const initialLessons = initialHasMore ? upcomingItems.slice(0, PAGE_SIZE) : upcomingItems;

  return <ParentLessonsContent initialLessons={initialLessons} initialHasMore={initialHasMore} past={pastResult.data} />;
}
