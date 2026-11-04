"use server";

import { redirect } from "next/navigation";

import type { UpcomingLesson } from "@swim-app/shared";

import { requireAuth } from "@/lib/requireAuth";
import { fetchUpcomingLessons } from "@/lib/api/lessons";
import { PAGE_SIZE } from "./constants";

export async function loadMoreUpcomingLessons(offset: number): Promise<UpcomingLesson[] | null> {
  const auth = await requireAuth();
  if (!auth) redirect("/login");
  if (auth.profile.role !== "parent") redirect("/dashboard");
  const result = await fetchUpcomingLessons(auth.accessToken, { limit: PAGE_SIZE + 1, offset });
  return result.ok ? result.data.items : null;
}
