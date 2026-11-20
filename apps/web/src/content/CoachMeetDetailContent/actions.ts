"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  CreateMeetSwimsBatchBodySchema,
  CreateMeetSwimBodySchema,
  PatchMeetBodySchema,
  PatchMeetSwimBodySchema,
  type BatchRowError,
  type CreateMeetSwimsBatchBody,
  type PatchMeetBody,
  type PatchMeetSwimBody,
} from "@swim-app/shared";
import { createClient } from "@/lib/supabase/server";
import { apiErrorMessage } from "@/lib/apiErrorMessage";

async function getToken(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

// ── Save pending-list batch ──────────────────────────────────────────────────

export type SaveBatchResult =
  | { status: "success"; inserted: number }
  | { status: "row_errors"; rowErrors: BatchRowError[] }
  | { status: "error"; message: string };

export async function saveBatchForMeet(
  meetId: string,
  rows: CreateMeetSwimsBatchBody["rows"],
): Promise<SaveBatchResult> {
  const token = await getToken();
  if (!token) redirect("/login");

  const parsed = CreateMeetSwimsBatchBodySchema.safeParse({ rows });
  if (!parsed.success) {
    return { status: "error", message: "Some rows are missing required fields." };
  }

  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/coach/meets/${meetId}/swims`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(parsed.data),
    },
  );

  if (response.status === 401) redirect("/api/signout");

  if (response.status === 422) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      rowErrors?: BatchRowError[];
    };
    if (body.error === "batch_validation_failed" && Array.isArray(body.rowErrors)) {
      return { status: "row_errors", rowErrors: body.rowErrors };
    }
    return { status: "error", message: apiErrorMessage(body.error) };
  }

  if (!response.ok) return { status: "error", message: apiErrorMessage(undefined) };

  revalidatePath(`/coach/meets/${meetId}`);
  const body = (await response.json().catch(() => ({ inserted: parsed.data.rows.length }))) as {
    inserted: number;
  };
  return { status: "success", inserted: body.inserted };
}

// ── Edit header ──────────────────────────────────────────────────────────────

export type PatchMeetResult =
  | { status: "success" }
  | { status: "error"; message: string };

export async function patchMeetHeader(
  meetId: string,
  body: PatchMeetBody,
): Promise<PatchMeetResult> {
  const token = await getToken();
  if (!token) redirect("/login");

  const parsed = PatchMeetBodySchema.safeParse(body);
  if (!parsed.success) {
    return { status: "error", message: "Nothing to update." };
  }

  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/coach/meets/${meetId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(parsed.data),
  });
  if (response.status === 401) redirect("/api/signout");
  if (response.status === 422) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    if (body.error === "meet_date_after_existing_swim") {
      return {
        status: "error",
        message: "This date is after an already-recorded result. Fix the result first, or pick an earlier date.",
      };
    }
    return { status: "error", message: apiErrorMessage(body.error) };
  }
  if (!response.ok) return { status: "error", message: apiErrorMessage(undefined) };
  revalidatePath(`/coach/meets/${meetId}`);
  return { status: "success" };
}

// ── Edit / delete saved swim ─────────────────────────────────────────────────

export type PatchSwimResult = { status: "success" } | { status: "error"; message: string };

export async function patchSavedSwim(
  swimmerId: string,
  swimId: string,
  meetId: string,
  body: PatchMeetSwimBody,
): Promise<PatchSwimResult> {
  const token = await getToken();
  if (!token) redirect("/login");

  const parsed = PatchMeetSwimBodySchema.safeParse(body);
  if (!parsed.success) return { status: "error", message: "Nothing to update." };

  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/coach/swimmers/${swimmerId}/meet-swims/${swimId}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(parsed.data),
    },
  );
  if (response.status === 401) redirect("/api/signout");
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    return { status: "error", message: apiErrorMessage(body.error) };
  }
  revalidatePath(`/coach/meets/${meetId}`);
  return { status: "success" };
}

export async function deleteSavedSwim(
  swimmerId: string,
  swimId: string,
  meetId: string,
): Promise<PatchSwimResult> {
  const token = await getToken();
  if (!token) redirect("/login");
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/coach/swimmers/${swimmerId}/meet-swims/${swimId}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (response.status === 401) redirect("/api/signout");
  if (!response.ok) return { status: "error", message: apiErrorMessage(undefined) };
  revalidatePath(`/coach/meets/${meetId}`);
  return { status: "success" };
}

// Kept so the legacy test imports keep working — the real entry UI uses
// saveBatchForMeet via the pending list, not this single-row action. Future
// callers should use the batch path.
export type AddSwimState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "success" };

export async function addSwim(
  meetId: string,
  _prev: AddSwimState,
  formData: FormData,
): Promise<AddSwimState> {
  const token = await getToken();
  if (!token) redirect("/login");

  const swimmerId = formData.get("swimmerId");
  if (typeof swimmerId !== "string" || !swimmerId) {
    return { status: "error", message: "Please select a swimmer." };
  }

  const raw = {
    meetId,
    eventDistance: Number(formData.get("eventDistance")),
    eventStroke: formData.get("eventStroke"),
    course: formData.get("course"),
    timeString: formData.get("timeString"),
    swumOn: formData.get("swumOn"),
  };

  const parsed = CreateMeetSwimBodySchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "error", message: "Please fill in all required fields." };
  }

  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/coach/swimmers/${swimmerId}/meet-swims`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(parsed.data),
    },
  );
  if (response.status === 401) redirect("/api/signout");
  if (response.status === 422) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    return { status: "error", message: apiErrorMessage(body.error) };
  }
  if (!response.ok) return { status: "error", message: apiErrorMessage(undefined) };
  revalidatePath(`/coach/meets/${meetId}`);
  return { status: "success" };
}
