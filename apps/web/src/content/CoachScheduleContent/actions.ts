"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type CoachLessonActionState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string };

export async function approveLessonAction(
  lessonId: string,
  _prev: CoachLessonActionState,
  _formData: FormData,
): Promise<CoachLessonActionState> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { status: "error", message: "Session expired. Please sign in again." };
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/coach/lessons/${lessonId}/approve`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({}),
      },
    );
    if (response.ok) {
      revalidatePath("/coach/schedule");
      revalidatePath("/coach");
      return { status: "success" };
    }
    return { status: "error", message: "Could not approve. Try again." };
  } catch {
    return { status: "error", message: "Could not reach the server. Try again." };
  }
}

export async function declineLessonAction(
  lessonId: string,
  _prev: CoachLessonActionState,
  formData: FormData,
): Promise<CoachLessonActionState> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { status: "error", message: "Session expired. Please sign in again." };
  const reason = (formData.get("reason") as string | null) ?? undefined;
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/coach/lessons/${lessonId}/decline`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...(reason !== undefined && { reason }) }),
      },
    );
    if (response.ok) {
      revalidatePath("/coach/schedule");
      revalidatePath("/coach");
      return { status: "success" };
    }
    return { status: "error", message: "Could not decline. Try again." };
  } catch {
    return { status: "error", message: "Could not reach the server. Try again." };
  }
}
