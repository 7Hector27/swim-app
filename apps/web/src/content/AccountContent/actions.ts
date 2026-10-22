"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { PatchMeBodySchema } from "@swim-app/shared";

import { isApiBody, mapZodErrors } from "@/lib/mapZodErrors";
import { logout } from "@/lib/logout";
import { createClient } from "@/lib/supabase/server";

import type { EditState } from "./helpers";
export type { EditState } from "./helpers";
export { logout };

export async function connectGoogleCalendar(): Promise<void> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    redirect("/api/signout");
  }

  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/integrations/google/start`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
  );
  if (response.status !== 200) {
    // 503 = integration not configured; anything else is an unexpected error.
    // Redirect back to /account; the status card will reflect reality.
    revalidatePath("/account");
    redirect("/account?google=error");
  }
  const body = (await response.json()) as { authorizeUrl?: unknown };
  if (typeof body.authorizeUrl !== "string") {
    redirect("/account?google=error");
  }
  redirect(body.authorizeUrl);
}

export async function disconnectGoogleCalendar(): Promise<void> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    redirect("/api/signout");
  }

  let ok = false;
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/coach/calendar`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    ok = response.ok;
  } catch {
    ok = false;
  }
  revalidatePath("/account");
  if (!ok) {
    redirect("/account?google=disconnect_error");
  }
}

export async function updateProfile(
  _prev: EditState,
  formData: FormData,
): Promise<EditState> {
  const raw = {
    fullName: ((formData.get("fullName") as string | null) ?? "").trim(),
    phone: (formData.get("phone") as string | null)?.trim() || null,
  };

  const parsed = PatchMeBodySchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "field_errors", errors: mapZodErrors(parsed.error.issues) };
  }

  const supabase = await createClient();
  // getSession is called only to extract the raw access token for forwarding to
  // the API. The API's requireUser middleware verifies the token independently.
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { status: "error", message: "Session expired." };

  let status: number;
  let body: unknown = null;

  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/me`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(parsed.data),
    });
    status = response.status;
    if (status !== 200) {
      try {
        body = await response.json();
      } catch {
        // non-JSON body
      }
    }
  } catch {
    return { status: "error", message: "Could not save changes." };
  }

  if (status === 200) return { status: "success" };

  if (status === 422 && isApiBody(body) && Array.isArray(body.issues)) {
    return { status: "field_errors", errors: mapZodErrors(body.issues) };
  }

  return { status: "error", message: "Could not save changes." };
}

