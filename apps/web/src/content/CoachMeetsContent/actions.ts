"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { CreateMeetBodySchema, MeetResponseSchema, type CreateMeetBody, type MeetResponse } from "@swim-app/shared";
import { createClient } from "@/lib/supabase/server";

// Mirrors the per-file helper in CoachMeetDetailContent/actions.ts and
// the other coach action files — pulls the raw Bearer token out of the
// SSR cookie session so the API's requireUser middleware can do the
// actual verification.
async function getToken(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export type CreateMeetState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success" };

export async function createMeet(
  _prev: CreateMeetState,
  formData: FormData,
): Promise<CreateMeetState> {
  const token = await getToken();
  if (!token) redirect("/login");

  const raw = {
    name: formData.get("name"),
    meetDate: formData.get("meetDate"),
    course: formData.get("course"),
  };

  const parsed = CreateMeetBodySchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "error", message: "Please fill in all required fields." };
  }

  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/coach/meets`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(parsed.data),
  });

  if (response.status === 401) redirect("/api/signout");
  if (!response.ok) {
    return { status: "error", message: "Could not create meet. Please try again." };
  }

  revalidatePath("/coach/meets");
  return { status: "success" };
}

// Transactional variant used by inline "+ Create a new meet" flows (e.g. the
// swimmer-detail Add-time form). Returns the created meet so the caller can
// snap it into the picker without a full refetch.
export type CreateMeetInlineResult =
  | { status: "success"; meet: MeetResponse }
  | { status: "error"; message: string };

export async function createMeetInline(
  body: CreateMeetBody,
): Promise<CreateMeetInlineResult> {
  const token = await getToken();
  if (!token) redirect("/login");

  const parsed = CreateMeetBodySchema.safeParse(body);
  if (!parsed.success) {
    return { status: "error", message: "Please fill in all required fields." };
  }

  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/coach/meets`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(parsed.data),
  });

  if (response.status === 401) redirect("/api/signout");
  if (!response.ok) {
    return { status: "error", message: "Could not create meet. Please try again." };
  }
  const json: unknown = await response.json().catch(() => null);
  const meetParsed = MeetResponseSchema.safeParse(json);
  if (!meetParsed.success) {
    return { status: "error", message: "Meet created but response was malformed." };
  }
  revalidatePath("/coach/meets");
  return { status: "success", meet: meetParsed.data };
}

export type DeleteMeetState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success" };

export async function deleteMeet(
  meetId: string,
  _prev: DeleteMeetState,
): Promise<DeleteMeetState> {
  const token = await getToken();
  if (!token) redirect("/login");

  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/coach/meets/${meetId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (response.status === 401) redirect("/api/signout");
  if (!response.ok) {
    return { status: "error", message: "Could not delete meet. Please try again." };
  }

  revalidatePath("/coach/meets");
  return { status: "success" };
}
