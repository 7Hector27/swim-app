import {
  AvailableSlotSchema,
  CoachStatsSchema,
  LessonLocationSchema,
  LessonResponseSchema,
  ScheduleItemSchema,
  UpcomingLessonSchema,
  type AvailableSlot,
  type CoachStats,
  type LessonLocation,
  type LessonResponse,
  type ScheduleItem,
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

export async function fetchCoachSchedule(
  accessToken: string,
  date: string,
): Promise<ScheduleItem[]> {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/coach/schedule?date=${date}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      },
    );
    if (!response.ok) return [];
    const body: unknown = await response.json();
    const parsed = ScheduleItemSchema.array().safeParse(body);
    if (!parsed.success) {
      console.warn("fetchCoachSchedule: 200 response did not match ScheduleItemSchema.array()");
      return [];
    }
    return parsed.data;
  } catch {
    return [];
  }
}

export async function fetchCoachStats(accessToken: string): Promise<CoachStats | null> {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/coach/stats`,
      { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" },
    );
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const parsed = CoachStatsSchema.safeParse(body);
    if (!parsed.success) {
      console.warn("fetchCoachStats: response did not match CoachStatsSchema");
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

export async function fetchUpcomingLessons(
  accessToken: string,
): Promise<UpcomingLesson[]> {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/lessons`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      },
    );
    if (!response.ok) return [];
    const body: unknown = await response.json();
    const parsed = UpcomingLessonSchema.array().safeParse(body);
    if (!parsed.success) {
      console.warn("fetchUpcomingLessons: 200 response did not match UpcomingLessonSchema.array()");
      return [];
    }
    return parsed.data;
  } catch {
    return [];
  }
}

export async function fetchLesson(accessToken: string, lessonId: string): Promise<UpcomingLesson | null> {
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/lessons/${lessonId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const parsed = UpcomingLessonSchema.safeParse(body);
    if (!parsed.success) {
      console.warn("fetchLesson: 200 response did not match UpcomingLessonSchema");
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

export async function fetchPastLessons(accessToken: string): Promise<UpcomingLesson[]> {
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/lessons?filter=past`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!response.ok) return [];
    const body: unknown = await response.json();
    const parsed = UpcomingLessonSchema.array().safeParse(body);
    if (!parsed.success) {
      console.warn("fetchPastLessons: response did not match UpcomingLessonSchema.array()");
      return [];
    }
    return parsed.data;
  } catch {
    return [];
  }
}

export async function cancelLesson(accessToken: string, lessonId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/lessons/${lessonId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (response.ok) return { ok: true };
    let errorCode: string | undefined;
    try {
      const data = await response.json() as { error?: string };
      errorCode = data.error;
    } catch {
      // non-JSON body
    }
    return { ok: false, error: errorCode ?? "Something went wrong." };
  } catch {
    return { ok: false, error: "Could not reach the server." };
  }
}

export async function updateLesson(
  accessToken: string,
  lessonId: string,
  body: { startsAt?: string; durationMinutes?: 30 | 45 | 60; locationId?: string },
): Promise<{ lesson: LessonResponse } | { error: string; code?: string }> {
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/lessons/${lessonId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    });
    const data: unknown = await response.json();
    if (response.ok) {
      const parsed = LessonResponseSchema.safeParse(data);
      if (parsed.success) return { lesson: parsed.data };
      return { error: "Unexpected response from server." };
    }
    const errorData = data as { error?: string };
    const code = errorData.error;
    return { error: code ?? "Something went wrong.", ...(code !== undefined ? { code } : {}) };
  } catch {
    return { error: "Could not reach the server." };
  }
}
