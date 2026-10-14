"use server";

import { createClient } from "@/lib/supabase/server";
import { fetchAvailableSlots } from "@/lib/api/lessons";
import { CreateLessonBodySchema, LessonResponseSchema, type AvailableSlot } from "@swim-app/shared";
import { mapBookingApiResponse, type BookLessonState } from "./helpers";

export async function fetchSlotsDirectAction(
  date: string,
  durationMinutes: 30 | 45 | 60,
  locationId: string,
): Promise<{ slots: AvailableSlot[] } | { error: string }> {
  const supabase = await createClient();
  // getSession is called only to extract the raw access token for forwarding to
  // the API. The API's requireUser middleware verifies the token independently.
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    return { error: "Session expired. Please sign in again." };
  }
  const slots = await fetchAvailableSlots(token, { date, durationMinutes, locationId });
  if (slots === null) {
    return { error: "Couldn't load times. Please try again." };
  }
  return { slots };
}

export async function createLessonAction(
  _prev: BookLessonState,
  formData: FormData,
): Promise<BookLessonState> {
  const parsed = CreateLessonBodySchema.safeParse({
    startsAt: formData.get("startsAt"),
    durationMinutes: Number(formData.get("durationMinutes")),
    locationId: formData.get("locationId"),
    swimmerIds: formData.getAll("swimmerIds"),
  });

  if (!parsed.success) {
    return { status: "error", message: "Missing required booking details. Please start over." };
  }

  const supabase = await createClient();
  // getSession is called only to extract the raw access token for forwarding to
  // the API. The API's requireUser middleware verifies the token independently.
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
      body: JSON.stringify(parsed.data),
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
    const result = LessonResponseSchema.safeParse(responseBody);
    const autoApproved = result.success ? result.data.status === "approved" : false;
    return { status: "success", autoApproved };
  }

  return mapBookingApiResponse(responseStatus, responseBody);
}
