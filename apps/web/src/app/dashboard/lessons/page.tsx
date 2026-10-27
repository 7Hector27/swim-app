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

  const [upcomingRaw, past] = await Promise.all([
    fetchUpcomingLessons(auth.accessToken, { limit: PAGE_SIZE + 1 }),
    fetchPastLessons(auth.accessToken),
  ]);

  if (upcomingRaw === null) {
    return (
      <p className="text-danger p-8">Couldn&apos;t load your lessons. Refresh to try again.</p>
    );
  }

  const upcomingItems = upcomingRaw.items;
  const initialHasMore = upcomingItems.length > PAGE_SIZE;
  const initialLessons = initialHasMore ? upcomingItems.slice(0, PAGE_SIZE) : upcomingItems;

  return <ParentLessonsContent initialLessons={initialLessons} initialHasMore={initialHasMore} past={past} />;
}
