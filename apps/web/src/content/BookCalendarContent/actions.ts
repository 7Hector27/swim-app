"use server";

import { createClient } from "@/lib/supabase/server";
import { fetchRangeAvailability, fetchAvailableSlots } from "@/lib/api/lessons";
import {
  type AvailableSlot,
  CreateLessonBodySchema,
  LessonResponseSchema,
  WeekAvailabilityResponseSchema,
  type WeekAvailabilityResponse,
} from "@swim-app/shared";
import { mapBookingApiResponse, type BookingState } from "./helpers";

export async function fetchSlotsDirectAction(
  date: string,
  durationMinutes: 30 | 45 | 60,
  locationId: string,
): Promise<{ slots: AvailableSlot[] } | { error: string }> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { error: "Session expired. Please sign in again." };
  const slots = await fetchAvailableSlots(token, { date, durationMinutes, locationId });
  if (slots === null) return { error: "Couldn't load times. Please try again." };
  return { slots };
}

export async function fetchRangeAction(params: {
  view: "week" | "month";
  date: string;
  durationMinutes: 30 | 45 | 60;
  locationId: string;
  excludeLessonId?: string;
}): Promise<WeekAvailabilityResponse | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;
  const result = await fetchRangeAvailability(token, params);
  if (result === null) return null;
  const parsed = WeekAvailabilityResponseSchema.safeParse(result);
  return parsed.success ? parsed.data : null;
}

export async function createBookingAction(
  _prev: BookingState,
  formData: FormData,
): Promise<BookingState> {
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
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { status: "error", message: "Session expired. Please sign in again." };

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
    const lessonId = result.success ? result.data.id : "";
    return { status: "success", lessonId, autoApproved };
  }

  return mapBookingApiResponse(responseStatus, responseBody);
}
