import {
  AvailableSlotSchema,
  CoachStatsSchema,
  LessonLocationSchema,
  LessonResponseSchema,
  ScheduleDaySchema,
  UpcomingLessonSchema,
  type AvailableSlot,
  type CoachStats,
  type LessonLocation,
  type LessonResponse,
  type ScheduleDay,
  type UpcomingLesson,
} from "@swim-app/shared";

export async function fetchLocations(accessToken: string): Promise<LessonLocation[]> {
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/locations`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return [];
    const body: unknown = await response.json();
    const parsed = LessonLocationSchema.array().safeParse(body);
    if (!parsed.success) {
      console.warn("fetchLocations: 200 response did not match LessonLocationSchema.array()");
      return [];
    }
    return parsed.data;
  } catch {
    return [];
  }
}

export async function fetchAvailableSlots(
  accessToken: string,
  params: { date: string; durationMinutes: 30 | 45 | 60; locationId: string },
): Promise<AvailableSlot[] | null> {
  try {
    const searchParams = new URLSearchParams({
      date: params.date,
      durationMinutes: String(params.durationMinutes),
      locationId: params.locationId,
    });
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/lessons/available-slots?${searchParams.toString()}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const parsed = AvailableSlotSchema.array().safeParse(body);
    if (!parsed.success) {
      console.warn("fetchAvailableSlots: 200 response did not match AvailableSlotSchema.array()");
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

export async function fetchUpcomingLessons(
  accessToken: string,
  params?: { limit?: number; after?: string },
): Promise<UpcomingLesson[]> {
  try {
    const searchParams = new URLSearchParams();
    if (params?.limit !== undefined) searchParams.set("limit", String(params.limit));
    if (params?.after !== undefined) searchParams.set("after", params.after);
    const qs = searchParams.toString();
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/lessons${qs ? `?${qs}` : ""}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!response.ok) return [];
    const body: unknown = await response.json();
    const parsed = UpcomingLessonSchema.array().safeParse(body);
    if (!parsed.success) {
      console.warn("fetchUpcomingLessons: response did not match schema");
      return [];
    }
    return parsed.data;
  } catch {
    return [];
  }
}

export async function fetchCoachSchedule(
  accessToken: string,
  date: string,
): Promise<ScheduleDay | null> {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/coach/schedule?date=${date}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const parsed = ScheduleDaySchema.safeParse(body);
    if (!parsed.success) {
      console.warn("fetchCoachSchedule: response did not match schema");
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

export async function fetchCoachStats(accessToken: string): Promise<CoachStats | null> {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/coach/stats`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const parsed = CoachStatsSchema.safeParse(body);
    if (!parsed.success) {
      console.warn("fetchCoachStats: response did not match schema");
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

export async function coachGetPendingLessons(accessToken: string): Promise<LessonResponse[]> {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/coach/lessons?status=pending`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    if (!response.ok) return [];
    const body: unknown = await response.json();
    const parsed = LessonResponseSchema.array().safeParse(body);
    if (!parsed.success) {
      console.warn("coachGetPendingLessons: 200 response did not match LessonResponseSchema.array()");
      return [];
    }
    return parsed.data;
  } catch {
    return [];
  }
}
