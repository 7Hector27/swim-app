"use server";

import { createClient } from "@/lib/supabase/server";
import { fetchCoachWeekSchedule, fetchRangeAvailability } from "@/lib/api/lessons";
import {
  WeekAvailabilityResponseSchema,
  type BalanceResponse,
  type CoachCreateLessonBody,
  type CoachHouseholdSearchResponse,
  type WeekAvailabilityResponse,
} from "@swim-app/shared";
import {
  createCoachLesson,
  fetchCoachHouseholds,
  type CoachCreateLessonResult,
} from "@/lib/api/coachBooking";
import { fetchCoachFamilyBalance } from "@/lib/api/coachHouseholds";
import { loadError, type LoadResult } from "@/lib/loadResult";

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

// Return LoadResult through the action boundary so the picker can show an
// InlineError on load failure instead of "no results." Unwrapping to null
// collapsed 5xx and "truly no results" into one indistinguishable state;
// per the audit, a failed search must be visibly different from an empty one.
export async function searchHouseholdsAction(
  q: string,
): Promise<LoadResult<CoachHouseholdSearchResponse>> {
  const token = await getAccessToken();
  if (!token) return loadError("server");
  return fetchCoachHouseholds(token, { q });
}

export async function fetchHouseholdByIdAction(
  householdId: string,
): Promise<LoadResult<CoachHouseholdSearchResponse>> {
  const token = await getAccessToken();
  if (!token) return loadError("server");
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
  const result = await fetchCoachWeekSchedule(token, mondayStr);
  if (!result.ok) return [];
  const flat: CoachWeekLesson[] = [];
  for (const day of result.data.days) {
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

// Fetch the selected family's current balance for the up-front Charge /
// Free toggle. Returns null on any failure so the UI falls back to
// "balance unknown" instead of guessing — the server's 422 fallback still
// catches an over-draft on submit.
export async function fetchFamilyBalanceAction(
  householdId: string,
): Promise<BalanceResponse | null> {
  const token = await getAccessToken();
  if (!token) return null;
  const result = await fetchCoachFamilyBalance(token, householdId);
  if ("kind" in result) return null;
  if (!result.ok) return null;
  return result.data;
}
