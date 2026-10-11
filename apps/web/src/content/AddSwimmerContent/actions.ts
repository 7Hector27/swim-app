"use server";

import { redirect } from "next/navigation";

import { CreateSwimmerBodySchema } from "@swim-app/shared";

import { mapZodErrors } from "@/lib/mapZodErrors";
import { createClient } from "@/lib/supabase/server";

import { mapApiResponse, type AddSwimmerState } from "./helpers";

export async function addSwimmer(
  _prev: AddSwimmerState,
  formData: FormData,
): Promise<AddSwimmerState> {
  let clubsParsed: unknown = [];
  try {
    const clubsJson = (formData.get("clubsJson") as string | null) ?? "[]";
    clubsParsed = JSON.parse(clubsJson);
  } catch {
    return { status: "error", message: "Something went wrong. Please try again." };
  }

  const isPublicRaw = formData.get("isPublic");
  const isPublic =
    isPublicRaw === "yes" ? true : isPublicRaw === "no" ? false : undefined;

  const raw = {
    firstName: ((formData.get("firstName") as string | null) ?? "").trim(),
    lastName: ((formData.get("lastName") as string | null) ?? "").trim(),
    birthDate: (formData.get("birthDate") as string | null) ?? "",
    sex: (formData.get("sex") as string | null) ?? undefined,
    isPublic,
    clubs: clubsParsed,
  };

  const parsed = CreateSwimmerBodySchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "field_errors", errors: mapZodErrors(parsed.error.issues) };
  }

  const supabase = await createClient();
  // getSession is called only to extract the raw access token for forwarding to
  // the API. The API's requireUser middleware verifies the token independently.
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { status: "error", message: "Session expired. Please sign in again." };

  let status: number;
  let body: unknown = null;

  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/swimmers`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(parsed.data),
    });
    status = response.status;
    if (status !== 201) {
      try {
        body = await response.json();
      } catch {
        // non-JSON body
      }
    }
  } catch {
    return { status: "error", message: "Could not reach the server. Please try again." };
  }

  if (status === 201) {
    redirect("/dashboard");
  }

  return mapApiResponse(status, body);
}
