"use server";

import { redirect } from "next/navigation";
import { CreateSessionBodySchema } from "@swim-app/shared";
import type { SaveDraftBody } from "@swim-app/shared";
import { createClient } from "@/lib/supabase/server";
import type { EvaluateState } from "./helpers";
import { mapSubmitResponse } from "./helpers";

export async function submitEvaluation(
  swimmerId: string,
  _prev: EvaluateState,
  formData: FormData,
): Promise<EvaluateState> {
  const supabase = await createClient();
  // getSession() is used only to extract the raw token for forwarding to the API.
  // The API's requireUser middleware calls getUser() server-to-server to verify it.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const rawJson = formData.get("bodyJson");
  if (typeof rawJson !== "string") {
    return { status: "error", message: "Something went wrong. Please try again." };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(rawJson);
  } catch {
    return { status: "error", message: "Something went wrong. Please try again." };
  }

  const parsed = CreateSessionBodySchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "error", message: "Some inputs are invalid. Please check and retry." };
  }

  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/coach/swimmers/${swimmerId}/sessions`,
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
  const body: unknown = await response.json().catch(() => null);
  return mapSubmitResponse(response.status, body);
}

export async function saveDraft(
  swimmerId: string,
  screenSlug: string,
  draftBody: SaveDraftBody,
): Promise<{ status: "saved"; id: string } | { status: "error"; message: string }> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/coach/swimmers/${swimmerId}/drafts/${screenSlug}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(draftBody),
    },
  );

  if (response.status === 401) redirect("/api/signout");
  if (response.status === 200) {
    const data = await response.json().catch(() => null) as { id?: string } | null;
    if (data?.id) return { status: "saved", id: data.id };
  }
  return { status: "error", message: "Could not save draft." };
}

export async function deleteDraft(draftId: string): Promise<void> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return;
  await fetch(`${process.env.NEXT_PUBLIC_API_URL}/coach/drafts/${draftId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${session.access_token}` },
  }).catch(() => null);
}
