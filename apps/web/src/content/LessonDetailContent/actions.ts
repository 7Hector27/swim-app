"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type LessonDetailState = { status: "idle" } | { status: "error"; message: string };

export async function cancelLessonAction(
  _prev: LessonDetailState,
  formData: FormData,
): Promise<LessonDetailState> {
  const lessonId = formData.get("lessonId");
  if (typeof lessonId !== "string") {
    return { status: "error", message: "Missing lesson ID." };
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { status: "error", message: "Session expired. Please sign in again." };

  let responseStatus: number;
  let responseBody: unknown = null;
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/lessons/${lessonId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    responseStatus = response.status;
    try { responseBody = await response.json(); } catch { /* non-JSON */ }
  } catch {
    return { status: "error", message: "Could not reach the server. Please try again." };
  }

  if (responseStatus >= 200 && responseStatus < 300) {
    redirect("/dashboard");
  }

  const code = (responseBody as { error?: string } | null)?.error;
  if (code === "lesson_not_active") {
    return { status: "error", message: "This lesson has already been canceled or completed." };
  }
  return { status: "error", message: "Could not cancel this lesson. Please try again." };
}

export async function rescheduleLessonAction(
  _prev: LessonDetailState,
  formData: FormData,
): Promise<LessonDetailState> {
  const lessonId = formData.get("lessonId");
  const startsAt = formData.get("startsAt");
  const durationMinutes = formData.get("durationMinutes");
  const locationId = formData.get("locationId");

  if (typeof lessonId !== "string" || typeof startsAt !== "string" || !startsAt) {
    return { status: "error", message: "Missing required fields." };
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { status: "error", message: "Session expired. Please sign in again." };

  const patchBody: { startsAt: string; durationMinutes?: number; locationId?: string } = { startsAt };
  if (durationMinutes && typeof durationMinutes === "string") {
    patchBody.durationMinutes = Number(durationMinutes);
  }
  if (locationId && typeof locationId === "string") {
    patchBody.locationId = locationId;
  }

  let responseStatus: number;
  let responseBody: unknown = null;
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/lessons/${lessonId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(patchBody),
    });
    responseStatus = response.status;
    try { responseBody = await response.json(); } catch { /* non-JSON */ }
  } catch {
    return { status: "error", message: "Could not reach the server. Please try again." };
  }

  if (responseStatus >= 200 && responseStatus < 300) {
    redirect("/dashboard");
  }

  const code = (responseBody as { error?: string } | null)?.error;
  const codeMessages: Record<string, string> = {
    too_soon: "The new time must be at least 16 hours from now.",
    too_far: "The new time must be within 10 weeks.",
    not_a_lesson_day: "Jason doesn't teach on that day.",
    slot_unavailable: "That time slot is no longer available.",
  };
  if (code && codeMessages[code]) return { status: "error", message: codeMessages[code]! };
  if (responseStatus === 403) return { status: "error", message: "You don't have permission to reschedule this lesson." };
  return { status: "error", message: "Something went wrong. Please try again." };
}
