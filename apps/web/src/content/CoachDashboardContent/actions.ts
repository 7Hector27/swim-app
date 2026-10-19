"use server";

import { createClient } from "@/lib/supabase/server";
import { fetchCoachSchedule } from "@/lib/api/lessons";
import type { ScheduleItem } from "@swim-app/shared";

export type GetCoachScheduleResult =
  | { ok: true; items: ScheduleItem[] }
  | { ok: false; error: string };

export async function getCoachScheduleAction(date: string): Promise<GetCoachScheduleResult> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { ok: false, error: "Session expired. Please sign in again." };
  try {
    const items = await fetchCoachSchedule(token, date);
    return { ok: true, items };
  } catch {
    return { ok: false, error: "Could not load schedule. Please try again." };
  }
}

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
  // getSession is called only to extract the raw access token for forwarding to
  // the API. The API's requireUser middleware verifies the token independently.
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
  // getSession is called only to extract the raw access token for forwarding to
  // the API. The API's requireUser middleware verifies the token independently.
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
