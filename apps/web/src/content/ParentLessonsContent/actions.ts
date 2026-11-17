"use server";

import { redirect } from "next/navigation";

import type { UpcomingLesson } from "@swim-app/shared";

import { requireAuth } from "@/lib/requireAuth";
import { fetchPastLessons, fetchUpcomingLessons } from "@/lib/api/lessons";
import { PAGE_SIZE } from "./constants";

export async function loadMoreUpcomingLessons(offset: number): Promise<UpcomingLesson[] | null> {
  const auth = await requireAuth();
  if (!auth) redirect("/login");
  if (auth.profile.role !== "parent") redirect("/dashboard");
  const result = await fetchUpcomingLessons(auth.accessToken, { limit: PAGE_SIZE + 1, offset });
  return result.ok ? result.data.items : null;
}

export interface PastPageResult {
  items: UpcomingLesson[];
  nextCursor: string | null;
}

export async function loadMorePastLessons(cursor: string): Promise<PastPageResult | null> {
  const auth = await requireAuth();
  if (!auth) redirect("/login");
  if (auth.profile.role !== "parent") redirect("/dashboard");
  const result = await fetchPastLessons(auth.accessToken, { limit: PAGE_SIZE, cursor });
  return result.ok ? result.data : null;
}
