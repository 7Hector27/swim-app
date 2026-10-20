"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { apiErrorMessage } from "@/lib/apiErrorMessage";

export const CoachLessonDetailStateSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("idle") }),
  z.object({ status: z.literal("error"), message: z.string() }),
]);
export type CoachLessonDetailState = z.infer<typeof CoachLessonDetailStateSchema>;

export async function cancelCoachLessonAction(
  _prev: CoachLessonDetailState,
  formData: FormData,
): Promise<CoachLessonDetailState> {
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
    redirect("/coach/schedule");
  }

  const code = (responseBody as { error?: string } | null)?.error;
  if (code === "lesson_not_active") {
    return { status: "error", message: apiErrorMessage("lesson_not_active") };
  }
  return { status: "error", message: "Could not cancel this lesson. Please try again." };
}

export async function approveCoachLessonAction(
  _prev: CoachLessonDetailState,
  formData: FormData,
): Promise<CoachLessonDetailState> {
  const lessonId = formData.get("lessonId");
  if (typeof lessonId !== "string") {
    return { status: "error", message: "Missing lesson ID." };
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { status: "error", message: "Session expired. Please sign in again." };

  let ok = false;
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/coach/lessons/${lessonId}/approve`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({}),
      },
    );
    ok = response.ok;
  } catch {
    return { status: "error", message: "Could not reach the server. Please try again." };
  }

  if (ok) redirect(`/coach/lessons/${lessonId}`);
  return { status: "error", message: "Could not approve this lesson. Please try again." };
}

export async function declineCoachLessonAction(
  _prev: CoachLessonDetailState,
  formData: FormData,
): Promise<CoachLessonDetailState> {
  const lessonId = formData.get("lessonId");
  if (typeof lessonId !== "string") {
    return { status: "error", message: "Missing lesson ID." };
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { status: "error", message: "Session expired. Please sign in again." };

  const reason = (formData.get("reason") as string | null) ?? undefined;

  let ok = false;
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/coach/lessons/${lessonId}/decline`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...(reason !== undefined && { reason }) }),
      },
    );
    ok = response.ok;
  } catch {
    return { status: "error", message: "Could not reach the server. Please try again." };
  }

  if (ok) redirect(`/coach/lessons/${lessonId}`);
  return { status: "error", message: "Could not decline this lesson. Please try again." };
}
