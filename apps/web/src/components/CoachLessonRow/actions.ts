"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export const CoachLessonActionStateSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("idle") }),
  z.object({ status: z.literal("success") }),
  z.object({ status: z.literal("error"), message: z.string() }),
]);
export type CoachLessonActionState = z.infer<typeof CoachLessonActionStateSchema>;

export async function approveLessonAction(
  lessonId: string,
  _prev: CoachLessonActionState,
  _formData: FormData,
): Promise<CoachLessonActionState> {
  const supabase = await createClient();
  // getSession is called only to extract the raw access token for forwarding to
  // the API. The API's requireUser middleware verifies the token independently.
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
    return { status: "error", message: "Could not approve the lesson. Please try again." };
  } catch {
    return { status: "error", message: "Could not reach the server. Please try again." };
  }
}

export async function declineLessonAction(
  lessonId: string,
  _prev: CoachLessonActionState,
  formData: FormData,
): Promise<CoachLessonActionState> {
  const supabase = await createClient();
  // getSession is called only to extract the raw access token for forwarding to
  // the API. The API's requireUser middleware verifies the token independently.
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
    return { status: "error", message: "Could not decline the lesson. Please try again." };
  } catch {
    return { status: "error", message: "Could not reach the server. Please try again." };
  }
}
