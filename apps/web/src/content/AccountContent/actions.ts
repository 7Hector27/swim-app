"use server";

import { redirect } from "next/navigation";
import { PatchMeBodySchema } from "@swim-app/shared";

import { mapZodErrors } from "@/lib/mapZodErrors";
import { createClient } from "@/lib/supabase/server";

export type EditState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; message: string }
  | { status: "field_errors"; errors: Record<string, string> };

export async function logout(_formData: FormData): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
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

interface ApiBody {
  error?: unknown;
  issues?: { path: (string | number)[]; message: string }[];
}

function isApiBody(body: unknown): body is ApiBody {
  return typeof body === "object" && body !== null;
}
