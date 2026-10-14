"use server";

import { createClient } from "@/lib/supabase/server";
import { fetchAvailableSlots } from "@/lib/api/lessons";
import { LessonResponseSchema, type AvailableSlot } from "@swim-app/shared";
import { mapBookingApiResponse, type BookLessonState } from "./helpers";

export async function fetchSlotsDirectAction(
  date: string,
  durationMinutes: 30 | 45 | 60,
  locationId: string,
): Promise<{ slots: AvailableSlot[] } | { error: string }> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    return { error: "Session expired. Please sign in again." };
  }
  const slots = await fetchAvailableSlots(token, { date, durationMinutes, locationId });
  return { slots };
}

export async function createLessonAction(
  _prev: BookLessonState,
  formData: FormData,
): Promise<BookLessonState> {
  const startsAt = (formData.get("startsAt") as string | null) ?? "";
  const durationMinutesRaw = Number(formData.get("durationMinutes"));
  const locationId = (formData.get("locationId") as string | null) ?? "";
  const swimmerIds = formData.getAll("swimmerIds") as string[];

  if (!startsAt || !locationId || swimmerIds.length === 0) {
    return { status: "error", message: "Missing required booking details. Please start over." };
  }

  if (
    durationMinutesRaw !== 30 &&
    durationMinutesRaw !== 45 &&
    durationMinutesRaw !== 60
  ) {
    return { status: "error", message: "Invalid lesson duration. Please start over." };
  }

  const durationMinutes: 30 | 45 | 60 = durationMinutesRaw;

  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    return { status: "error", message: "Session expired. Please sign in again." };
  }

  let responseStatus: number;
  let responseBody: unknown = null;

  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/lessons`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ startsAt, durationMinutes, locationId, swimmerIds }),
    });
    responseStatus = response.status;
    try {
      responseBody = await response.json();
    } catch {
      // non-JSON body
    }
  } catch {
    return { status: "error", message: "Could not reach the server. Please try again." };
  }

  if (responseStatus === 201) {
    const parsed = LessonResponseSchema.safeParse(responseBody);
    const autoApproved = parsed.success ? parsed.data.status === "approved" : false;
    return { status: "success", autoApproved };
  }

  return mapBookingApiResponse(responseStatus, responseBody);
}
