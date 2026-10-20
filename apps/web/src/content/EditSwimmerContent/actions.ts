"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { UpdateSwimmerBodySchema } from "@swim-app/shared";
import type { ParentSwimmer } from "@swim-app/shared";

import { z } from "zod";

import { mapZodErrors } from "@/lib/mapZodErrors";
import { createClient } from "@/lib/supabase/server";

import {
  getChangedFields,
  InitialSnapshotSchema,
  mapApiResponse,
  mapPublicToggleApiResponse,
  toClubInputs,
} from "./helpers";
import type { EditSwimmerState, PublicToggleState } from "./helpers";

const UuidSchema = z.string().uuid();

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

  let initialSnapshot: z.infer<typeof InitialSnapshotSchema> | null = null;
  const initialJson = (formData.get("initialJson") as string | null) ?? null;
  if (initialJson) {
    let raw: unknown;
    try {
      raw = JSON.parse(initialJson);
    } catch {
      return { status: "error", message: "Something went wrong. Please try again." };
    }
    const parsed = InitialSnapshotSchema.safeParse(raw);
    if (!parsed.success) {
      return { status: "error", message: "Something went wrong. Please try again." };
    }
    initialSnapshot = parsed.data;
  }

  const firstName = ((formData.get("firstName") as string | null) ?? "").trim();
  const lastName = ((formData.get("lastName") as string | null) ?? "").trim();
  const birthDate = (formData.get("birthDate") as string | null) ?? "";
  const sex = (formData.get("sex") as string | null) ?? undefined;

  const updatedClubs = toClubInputs(clubsParsed as ParentSwimmer["clubs"]);

  const body = initialSnapshot
    ? getChangedFields(initialSnapshot, {
        firstName,
        lastName,
        birthDate,
        sex: sex as "female" | "male",
        isPublic: initialSnapshot.isPublic,
        clubs: updatedClubs,
      })
    : (() => {
        const raw = { firstName, lastName, birthDate, sex, clubs: clubsParsed };
        const parsed = UpdateSwimmerBodySchema.safeParse(raw);
        return parsed.success ? parsed.data : null;
      })();

  if (body === null) {
    return { status: "no_changes" };
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
    revalidatePath("/dashboard");
    redirect("/dashboard");
  }

  return mapApiResponse(status, responseBody);
}

export async function toggleSwimmerPublic(
  swimmerId: string,
  isPublic: boolean,
  _prev: PublicToggleState,
  formData: FormData,
): Promise<PublicToggleState> {
  const swimmerIdResult = UuidSchema.safeParse(swimmerId);
  if (!swimmerIdResult.success) {
    return { status: "error", message: "Something went wrong. Please try again." };
  }
  if (typeof isPublic !== "boolean") {
    return { status: "error", message: "Something went wrong. Please try again." };
  }

  if (isPublic) {
    const consentAcknowledged = formData.get("consentAcknowledged") === "true";
    if (!consentAcknowledged) {
      return { status: "error", message: "Please check the consent checkbox to continue." };
    }
  }

  const supabase = await createClient();
  // getSession is called only to extract the raw access token for forwarding to
  // the API. The API's requireUser middleware verifies the token independently.
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { status: "error", message: "Session expired. Please sign in again." };

  const requestBody = isPublic
    ? { isPublic: true as const, consentAcknowledged: true as const }
    : { isPublic: false as const };

  let status: number;

  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/swimmers/${swimmerIdResult.data}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(requestBody),
      },
    );
    status = response.status;
  } catch {
    return { status: "error", message: "Could not reach the server. Please try again." };
  }

  const result = mapPublicToggleApiResponse(status, isPublic ? "enable" : "disable");
  if (result.status === "idle") {
    revalidatePath(`/dashboard/swimmers/${swimmerIdResult.data}`);
    revalidatePath("/dashboard");
  }
  return result;
}
