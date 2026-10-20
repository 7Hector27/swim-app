"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { apiErrorMessage } from "@/lib/apiErrorMessage";
import type { CoachRescheduleState } from "./schemas";

export type { CoachRescheduleState } from "./schemas";

export async function coachRescheduleLessonAction(
  _prev: CoachRescheduleState,
  formData: FormData,
): Promise<CoachRescheduleState> {
  const lessonId = formData.get("lessonId");
  const newStartsAt = formData.get("newStartsAt");
  const durationMinutes = formData.get("durationMinutes");
  const locationId = formData.get("locationId");

  if (typeof lessonId !== "string" || typeof newStartsAt !== "string" || !newStartsAt) {
    return { status: "error", message: "Missing required fields." };
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { status: "error", message: "Session expired. Please sign in again." };

  const patchBody: Record<string, unknown> = { startsAt: newStartsAt };
  if (typeof durationMinutes === "string" && durationMinutes) {
    patchBody.durationMinutes = Number(durationMinutes);
  }
  if (typeof locationId === "string" && locationId) {
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
    try {
      responseBody = await response.json();
    } catch {
      // non-JSON body
    }
  } catch {
    return { status: "error", message: "Could not reach the server. Please try again." };
  }

  if (responseStatus >= 200 && responseStatus < 300) {
    redirect(`/coach/lessons/${lessonId}`);
  }

  const code = (responseBody as { error?: string } | null)?.error;
  if (responseStatus === 403)
    return { status: "error", message: "You don't have permission to reschedule this lesson." };
  if (code) return { status: "error", message: apiErrorMessage(code) };
  return { status: "error", message: apiErrorMessage(undefined) };
}

export async function coachCancelLessonAction(
  _prev: CoachRescheduleState,
  formData: FormData,
): Promise<CoachRescheduleState> {
  const lessonId = formData.get("lessonId");
  if (typeof lessonId !== "string") return { status: "error", message: "Missing lesson ID." };

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
    try {
      responseBody = await response.json();
    } catch {
      // non-JSON body
    }
  } catch {
    return { status: "error", message: "Could not reach the server. Please try again." };
  }

  if (responseStatus >= 200 && responseStatus < 300) redirect("/coach/schedule");

  const code = (responseBody as { error?: string } | null)?.error;
  if (code === "lesson_not_active")
    return { status: "error", message: apiErrorMessage("lesson_not_active") };
  return { status: "error", message: "Could not cancel this lesson. Please try again." };
}
