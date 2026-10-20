"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { UpdateSwimmerBodySchema } from "@swim-app/shared";

import { mapZodErrors } from "@/lib/mapZodErrors";
import { createClient } from "@/lib/supabase/server";

import {
  getChangedFields,
  mapApiResponse,
  mapPublicToggleApiResponse,
  toClubInputs,
} from "./helpers";
import type { EditSwimmerState, PublicToggleState } from "./helpers";
import type { ParentSwimmer } from "@swim-app/shared";

type InitialSnapshot = {
  firstName: string;
  lastName: string;
  birthDate: string;
  sex: "female" | "male";
  isPublic: boolean;
  clubs: ParentSwimmer["clubs"];
};

export async function editSwimmer(
  swimmerId: string,
  _prev: EditSwimmerState,
  formData: FormData,
): Promise<EditSwimmerState> {
  let clubsParsed: unknown = [];
  try {
    const clubsJson = (formData.get("clubsJson") as string | null) ?? "[]";
    clubsParsed = JSON.parse(clubsJson);
  } catch {
    return { status: "error", message: "Something went wrong. Please try again." };
  }

  let initialSnapshot: InitialSnapshot | null = null;
  try {
    const initialJson = (formData.get("initialJson") as string | null) ?? null;
    if (initialJson) initialSnapshot = JSON.parse(initialJson) as InitialSnapshot;
  } catch {
    return { status: "error", message: "Something went wrong. Please try again." };
  }

  const firstName = ((formData.get("firstName") as string | null) ?? "").trim();
  const lastName = ((formData.get("lastName") as string | null) ?? "").trim();
  const birthDate = (formData.get("birthDate") as string | null) ?? "";
  const sex = (formData.get("sex") as string | null) ?? undefined;

  const updated = {
    firstName,
    lastName,
    birthDate,
    sex: sex as "female" | "male",
    isPublic: initialSnapshot?.isPublic ?? false,
    clubs: clubsParsed as ParentSwimmer["clubs"],
  };

  const initial = initialSnapshot
    ? {
        firstName: initialSnapshot.firstName,
        lastName: initialSnapshot.lastName,
        birthDate: initialSnapshot.birthDate,
        sex: initialSnapshot.sex,
        isPublic: initialSnapshot.isPublic,
        clubs: toClubInputs(initialSnapshot.clubs),
      }
    : null;

  const body = initial
    ? getChangedFields(initial, { ...updated, clubs: toClubInputs(updated.clubs) })
    : (() => {
        const raw = {
          firstName,
          lastName,
          birthDate,
          sex,
          clubs: clubsParsed,
        };
        const parsed = UpdateSwimmerBodySchema.safeParse(raw);
        return parsed.success ? parsed.data : null;
      })();

  if (body === null) {
    redirect("/dashboard");
  }

  const validationResult = UpdateSwimmerBodySchema.safeParse(body);
  if (!validationResult.success) {
    return { status: "field_errors", errors: mapZodErrors(validationResult.error.issues) };
  }

  const supabase = await createClient();
  // getSession is called only to extract the raw access token for forwarding to
  // the API. The API's requireUser middleware verifies the token independently.
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { status: "error", message: "Session expired. Please sign in again." };

  let status: number;
  let responseBody: unknown = null;

  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/swimmers/${swimmerId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(validationResult.data),
    });
    status = response.status;
    if (status !== 200) {
      try {
        responseBody = await response.json();
      } catch {
        // non-JSON body
      }
    }
  } catch {
    return { status: "error", message: "Could not reach the server. Please try again." };
  }

  if (status === 200) {
    redirect("/dashboard");
  }

  return mapApiResponse(status, responseBody);
}

export async function toggleSwimmerPublic(
  swimmerId: string,
  isPublic: boolean,
  _prev: PublicToggleState,
): Promise<PublicToggleState> {
  const supabase = await createClient();
  // getSession is called only to extract the raw access token for forwarding to
  // the API. The API's requireUser middleware verifies the token independently.
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { status: "error", message: "Session expired. Please sign in again." };

  let status: number;

  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/swimmers/${swimmerId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ isPublic }),
    });
    status = response.status;
  } catch {
    return { status: "error", message: "Could not reach the server. Please try again." };
  }

  const result = mapPublicToggleApiResponse(status);
  if (result.status === "idle") {
    revalidatePath(`/dashboard/swimmers/${swimmerId}`);
  }
  return result;
}
