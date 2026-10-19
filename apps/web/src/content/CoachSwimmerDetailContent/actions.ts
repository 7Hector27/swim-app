"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { CreateMeetSwimBodySchema, PatchMeetSwimBodySchema } from "@swim-app/shared";
import type { CoachSkillRating } from "@swim-app/shared";
import { createClient } from "@/lib/supabase/server";
import { fetchSkillRatingHistory, voidRating } from "@/lib/api/evaluations";
import type { HideSwimmerState } from "./helpers";
import { mapHideApiResponse } from "./helpers";

export type FetchSkillRatingHistoryResult =
  | { ok: true; ratings: CoachSkillRating[] }
  | { ok: false; status: number };

export type VoidRatingResult =
  | { ok: true }
  | { ok: false; status: number };

async function getToken(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function fetchSkillRatingHistoryAction(
  swimmerId: string,
  skillId: string,
): Promise<FetchSkillRatingHistoryResult> {
  const token = await getToken();
  if (!token) return { ok: false, status: 401 };
  return fetchSkillRatingHistory(swimmerId, skillId, token);
}

export async function voidRatingAction(
  ratingId: string,
  reason: string,
): Promise<VoidRatingResult> {
  const token = await getToken();
  if (!token) return { ok: false, status: 401 };
  return voidRating(ratingId, reason, token);
}

export async function hideSwimmer(
  swimmerId: string,
  _prev: HideSwimmerState,
): Promise<HideSwimmerState> {
  const supabase = await createClient();
  // getSession is called only to extract the raw access token for forwarding to
  // the API. The API's requireUser middleware verifies the token independently.
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect("/login");
  }

  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/coach/swimmers/${swimmerId}/visibility`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ isPublic: false }),
    },
  );

  if (response.status === 204) {
    redirect(`/coach/swimmers/${swimmerId}`);
  }

  return mapHideApiResponse(response.status);
}

export type AddSwimState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success" };

export async function addSwimForSwimmer(
  swimmerId: string,
  _prev: AddSwimState,
  formData: FormData,
): Promise<AddSwimState> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const meetId = formData.get("meetId");
  const swimType = meetId ? "meet" : "practice";

  const raw: Record<string, unknown> = {
    swimType,
    eventDistance: Number(formData.get("eventDistance")),
    eventStroke: formData.get("eventStroke"),
    course: formData.get("course"),
    timeString: formData.get("timeString"),
    swumOn: formData.get("swumOn"),
  };
  if (meetId) raw["meetId"] = meetId;

  const parsed = CreateMeetSwimBodySchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "error", message: "Please fill in all required fields." };
  }

  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/coach/swimmers/${swimmerId}/meet-swims`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(parsed.data),
    },
  );

  if (response.status === 401) redirect("/api/signout");
  if (response.status === 422) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (body.error === "invalid_event") {
      return { status: "error", message: "That distance and stroke combination is not a valid event." };
    }
    if (body.error === "invalid_time") {
      return { status: "error", message: "Invalid time. Use M:SS.HH or SS.HH (e.g. 1:02.34 or 58.30)." };
    }
    return { status: "error", message: "Invalid swim data. Please check your entries." };
  }
  if (!response.ok) {
    return { status: "error", message: "Could not record swim. Please try again." };
  }

  revalidatePath(`/coach/swimmers/${swimmerId}`);
  return { status: "success" };
}

export type EditSwimState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success" };

export async function editSwimForSwimmer(
  swimmerId: string,
  swimId: string,
  _prev: EditSwimState,
  formData: FormData,
): Promise<EditSwimState> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const raw: Record<string, unknown> = {};
  const timeString = formData.get("timeString");
  const swumOn = formData.get("swumOn");
  if (timeString) raw["timeString"] = timeString;
  if (swumOn) raw["swumOn"] = swumOn;

  const parsed = PatchMeetSwimBodySchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "error", message: "Please provide at least one field to update." };
  }

  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/coach/swimmers/${swimmerId}/meet-swims/${swimId}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(parsed.data),
    },
  );

  if (response.status === 401) redirect("/api/signout");
  if (response.status === 422) {
    return { status: "error", message: "Invalid time. Use M:SS.HH or SS.HH (e.g. 1:02.34 or 58.30)." };
  }
  if (!response.ok) {
    return { status: "error", message: "Could not update swim. Please try again." };
  }

  revalidatePath(`/coach/swimmers/${swimmerId}`);
  return { status: "success" };
}

export type DeleteSwimState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success" };

export async function deleteSwimForSwimmer(
  swimmerId: string,
  swimId: string,
  _prev: DeleteSwimState,
): Promise<DeleteSwimState> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/coach/swimmers/${swimmerId}/meet-swims/${swimId}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${session.access_token}` },
    },
  );

  if (response.status === 401) redirect("/api/signout");
  if (!response.ok) {
    return { status: "error", message: "Could not delete swim. Please try again." };
  }

  revalidatePath(`/coach/swimmers/${swimmerId}`);
  return { status: "success" };
}
