"use server";

import { createClient } from "@/lib/supabase/server";
import { fetchCoachWeekSchedule, fetchRangeAvailability } from "@/lib/api/lessons";
import {
  WeekAvailabilityResponseSchema,
  type CoachCreateLessonBody,
  type CoachHouseholdSearchResponse,
  type WeekAvailabilityResponse,
} from "@swim-app/shared";
import {
  createCoachLesson,
  fetchCoachHouseholds,
  type CoachCreateLessonResult,
} from "@/lib/api/coachBooking";

// Flat shape used by the custom-time overlap check. Captures the minimum
// needed (UTC start + duration + display location name) so the client
// doesn't need to understand the full week-schedule response.
export interface CoachWeekLesson {
  startsAtUtc: string;
  durationMinutes: number;
  locationName: string;
}

async function getAccessToken(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function searchHouseholdsAction(
  q: string,
): Promise<CoachHouseholdSearchResponse | null> {
  const token = await getAccessToken();
  if (!token) return null;
  return fetchCoachHouseholds(token, { q });
}

export async function fetchHouseholdByIdAction(
  householdId: string,
): Promise<CoachHouseholdSearchResponse | null> {
  const token = await getAccessToken();
  if (!token) return null;
  return fetchCoachHouseholds(token, { householdId });
}

export async function fetchCoachRangeAction(params: {
  date: string;
  durationMinutes: 30 | 45 | 60;
  locationId: string;
}): Promise<WeekAvailabilityResponse | null> {
  const token = await getAccessToken();
  if (!token) return null;
  // Coach booking has no 16-hour notice rule; ask the server to skip it.
  const result = await fetchRangeAvailability(token, {
    view: "week",
    ...params,
    coachBypassNotice: true,
  });
  if (result === null) return null;
  const parsed = WeekAvailabilityResponseSchema.safeParse(result);
  return parsed.success ? parsed.data : null;
}

// Returns every pending or approved lesson in the given LA Monday-anchored
// week, flattened to {startsAtUtc, durationMinutes, locationName}. Used by
// Step2TimePicker to run a client-side overlap check across ALL pools (the
// server's hard-reject rule — ADR 029). Empty array on error so the UI can
// still render; the server has the authoritative check.
export async function fetchCoachWeekLessonsAction(
  mondayStr: string,
): Promise<CoachWeekLesson[]> {
  const token = await getAccessToken();
  if (!token) return [];
  const response = await fetchCoachWeekSchedule(token, mondayStr);
  if (response === null) return [];
  const flat: CoachWeekLesson[] = [];
  for (const day of response.days) {
    for (const item of day.items) {
      flat.push({
        startsAtUtc: item.lesson.startsAt,
        durationMinutes: item.lesson.durationMinutes,
        locationName: item.locationName,
      });
    }
  }
  return flat;
}

export async function submitCoachBookingAction(
  body: CoachCreateLessonBody,
): Promise<CoachCreateLessonResult> {
  const token = await getAccessToken();
  if (!token) {
    return { kind: "error", message: "Session expired. Please sign in again." };
  }
  return createCoachLesson(token, body);
}
