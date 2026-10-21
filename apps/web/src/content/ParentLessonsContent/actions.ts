"use server";

import { redirect } from "next/navigation";

import type { UpcomingLesson } from "@swim-app/shared";

import { requireAuth } from "@/lib/requireAuth";
import { fetchUpcomingLessons } from "@/lib/api/lessons";

const PAGE_SIZE = 10;

export async function loadMoreUpcomingLessons(offset: number): Promise<UpcomingLesson[] | null> {
  const auth = await requireAuth();
  if (!auth) redirect("/login");
  return fetchUpcomingLessons(auth.accessToken, { limit: PAGE_SIZE + 1, offset });
}
