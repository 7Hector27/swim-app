import { apiFetch } from "./apiFetch";

import {
  AvailableSlotSchema,
  CoachLessonDetailSchema,
  CoachNoteResponseSchema,
  CoachScheduleItemSchema,
  CoachStatsSchema,
  LessonLocationSchema,
  LessonResponseSchema,
  MonthAvailabilityResponseSchema,
  UpcomingLessonSchema,
  WeekAvailabilityResponseSchema,
  type AvailableSlot,
  type CoachLessonDetail,
  type CoachNoteResponse,
  type CoachScheduleItem,
  type CoachStats,
  type LessonLocation,
  type LessonResponse,
  type MonthAvailabilityResponse,
  type UpcomingLesson,
  type WeekAvailabilityResponse,
} from "@swim-app/shared";

export async function fetchLocations(accessToken: string): Promise<LessonLocation[]> {
  try {
    const response = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL}/locations`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return [];
    const body: unknown = await response.json();
    const parsed = LessonLocationSchema.array().safeParse(body);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((issue) => `${issue.path.join(".")} (${issue.message})`).join("; ");
      console.warn(`fetchLocations: response shape mismatch — ${detail}`);
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
    const response = await apiFetch(
      `${process.env.NEXT_PUBLIC_API_URL}/lessons/available-slots?${searchParams.toString()}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const parsed = AvailableSlotSchema.array().safeParse(body);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((issue) => `${issue.path.join(".")} (${issue.message})`).join("; ");
      console.warn(`fetchAvailableSlots: response shape mismatch — ${detail}`);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

export async function coachGetPendingLessons(accessToken: string): Promise<LessonResponse[]> {
  try {
    const response = await apiFetch(
      `${process.env.NEXT_PUBLIC_API_URL}/coach/lessons?status=pending`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    if (!response.ok) return [];
    const body: unknown = await response.json();
    const parsed = LessonResponseSchema.array().safeParse(body);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((issue) => `${issue.path.join(".")} (${issue.message})`).join("; ");
      console.warn(`coachGetPendingLessons: response shape mismatch — ${detail}`);
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
): Promise<CoachScheduleItem[]> {
  try {
    const response = await apiFetch(
      `${process.env.NEXT_PUBLIC_API_URL}/coach/schedule?date=${date}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      },
    );
    if (!response.ok) return [];
    const body: unknown = await response.json();
    const parsed = CoachScheduleItemSchema.array().safeParse(body);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((issue) => `${issue.path.join(".")} (${issue.message})`).join("; ");
      console.warn(`fetchCoachSchedule: response shape mismatch — ${detail}`);
      return [];
    }
    return parsed.data;
  } catch {
    return [];
  }
}

export async function fetchCoachLesson(
  accessToken: string,
  lessonId: string,
): Promise<CoachLessonDetail | null> {
  try {
    const response = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL}/coach/lessons/${lessonId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const parsed = CoachLessonDetailSchema.safeParse(body);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((issue) => `${issue.path.join(".")} (${issue.message})`).join("; ");
      console.warn(`fetchCoachLesson: response shape mismatch — ${detail}`);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

export async function fetchLessonNotes(
  accessToken: string,
  lessonId: string,
): Promise<CoachNoteResponse[]> {
  try {
    const response = await apiFetch(
      `${process.env.NEXT_PUBLIC_API_URL}/coach/lessons/${lessonId}/notes`,
      { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" },
    );
    if (!response.ok) return [];
    const body: unknown = await response.json();
    const parsed = CoachNoteResponseSchema.array().safeParse(body);
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export async function fetchCoachStats(accessToken: string): Promise<CoachStats | null> {
  try {
    const response = await apiFetch(
      `${process.env.NEXT_PUBLIC_API_URL}/coach/stats`,
      { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" },
    );
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const parsed = CoachStatsSchema.safeParse(body);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((issue) => `${issue.path.join(".")} (${issue.message})`).join("; ");
      console.warn(`fetchCoachStats: response shape mismatch — ${detail}`);
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
    const response = await apiFetch(
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
      const detail = parsed.error.issues.map((issue) => `${issue.path.join(".")} (${issue.message})`).join("; ");
      console.warn(`fetchUpcomingLessons: response shape mismatch — ${detail}`);
      return [];
    }
    return parsed.data;
  } catch {
    return [];
  }
}

export async function fetchLesson(accessToken: string, lessonId: string): Promise<UpcomingLesson | null> {
  try {
    const response = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL}/lessons/${lessonId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const parsed = UpcomingLessonSchema.safeParse(body);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((issue) => `${issue.path.join(".")} (${issue.message})`).join("; ");
      console.warn(`fetchLesson: response shape mismatch — ${detail}`);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

export async function fetchPastLessons(accessToken: string): Promise<UpcomingLesson[]> {
  try {
    const response = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL}/lessons?filter=past`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!response.ok) return [];
    const body: unknown = await response.json();
    const parsed = UpcomingLessonSchema.array().safeParse(body);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((issue) => `${issue.path.join(".")} (${issue.message})`).join("; ");
      console.warn(`fetchPastLessons: response shape mismatch — ${detail}`);
      return [];
    }
    return parsed.data;
  } catch {
    return [];
  }
}

export async function cancelLesson(accessToken: string, lessonId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL}/lessons/${lessonId}`, {
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
    const response = await apiFetch(`${process.env.NEXT_PUBLIC_API_URL}/lessons/${lessonId}`, {
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

export async function fetchRangeAvailability(
  accessToken: string,
  params: {
    view: "week" | "month";
    date: string;
    durationMinutes: 30 | 45 | 60;
    locationId: string;
    excludeLessonId?: string;
  },
): Promise<WeekAvailabilityResponse | MonthAvailabilityResponse | null> {
  try {
    const searchParams = new URLSearchParams({
      view: params.view,
      date: params.date,
      durationMinutes: String(params.durationMinutes),
      locationId: params.locationId,
    });
    if (params.excludeLessonId !== undefined) {
      searchParams.set("excludeLessonId", params.excludeLessonId);
    }
    const response = await apiFetch(
      `${process.env.NEXT_PUBLIC_API_URL}/lessons/available-range?${searchParams.toString()}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (params.view === "week") {
      const parsed = WeekAvailabilityResponseSchema.safeParse(body);
      if (!parsed.success) {
        const detail = parsed.error.issues.map((issue) => `${issue.path.join(".")} (${issue.message})`).join("; ");
        console.warn(`fetchRangeAvailability: week response shape mismatch — ${detail}`);
        return null;
      }
      return parsed.data;
    }
    const parsed = MonthAvailabilityResponseSchema.safeParse(body);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((issue) => `${issue.path.join(".")} (${issue.message})`).join("; ");
      console.warn(`fetchRangeAvailability: month response shape mismatch — ${detail}`);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}
