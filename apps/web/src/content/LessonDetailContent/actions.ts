"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { apiErrorMessage } from "@/lib/apiErrorMessage";

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
    return { status: "error", message: apiErrorMessage("lesson_not_active") };
  }
  return { status: "error", message: "Could not cancel this lesson. Please try again." };
}

export async function cancelBatchRemainingAction(
  _prev: LessonDetailState,
  formData: FormData,
): Promise<LessonDetailState> {
  const batchId = formData.get("batchId");
  if (typeof batchId !== "string") {
    return { status: "error", message: "Missing batch ID." };
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { status: "error", message: "Session expired. Please sign in again." };

  let responseStatus: number;
  let responseBody: unknown = null;
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/lessons/batch/${batchId}/remaining`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    responseStatus = response.status;
    try { responseBody = await response.json(); } catch { /* non-JSON */ }
  } catch {
    return { status: "error", message: "Could not reach the server. Please try again." };
  }

  if (responseStatus >= 200 && responseStatus < 300) {
    redirect("/dashboard");
  }

  const code = (responseBody as { error?: string } | null)?.error;
  if (responseStatus === 403) {
    return { status: "error", message: "You don't have permission to cancel this booking." };
  }
  if (code === "no_remaining_lessons") {
    return { status: "error", message: "No lessons left to cancel in this booking." };
  }
  return { status: "error", message: "Could not cancel the remaining lessons. Please try again." };
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
  if (responseStatus === 403) return { status: "error", message: "You don't have permission to reschedule this lesson." };
  if (code) return { status: "error", message: apiErrorMessage(code) };
  return { status: "error", message: apiErrorMessage(undefined) };
}
