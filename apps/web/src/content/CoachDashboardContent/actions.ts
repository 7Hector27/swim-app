"use server";

import { createClient } from "@/lib/supabase/server";

export type CoachActionState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

export async function approveLessonAction(
  lessonId: string,
  _prev: CoachActionState,
  _formData: FormData,
): Promise<CoachActionState> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    return { status: "error", message: "Session expired. Please sign in again." };
  }

  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/coach/lessons/${lessonId}/approve`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      },
    );
    if (response.ok) {
      return { status: "success" };
    }
    return { status: "error", message: "Could not approve the lesson. Please try again." };
  } catch {
    return { status: "error", message: "Could not reach the server. Please try again." };
  }
}

export async function declineLessonAction(
  lessonId: string,
  _prev: CoachActionState,
  formData: FormData,
): Promise<CoachActionState> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    return { status: "error", message: "Session expired. Please sign in again." };
  }

  const reason = (formData.get("reason") as string | null) ?? undefined;

  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/coach/lessons/${lessonId}/decline`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ ...(reason !== undefined && { reason }) }),
      },
    );
    if (response.ok) {
      return { status: "success" };
    }
    return { status: "error", message: "Could not decline the lesson. Please try again." };
  } catch {
    return { status: "error", message: "Could not reach the server. Please try again." };
  }
}
