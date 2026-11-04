import {
  AvailableSlotSchema,
  CoachBatchDetailSchema,
  CoachLessonDetailSchema,
  CoachNoteResponseSchema,
  CoachScheduleItemSchema,
  CoachStatsSchema,
  CoachWeekScheduleResponseSchema,
  LessonLocationSchema,
  LessonResponseSchema,
  MonthAvailabilityResponseSchema,
  UpcomingLessonSchema,
  UpcomingLessonsResponseSchema,
  WeekAvailabilityResponseSchema,
  type AvailableSlot,
  type CoachBatchDetail,
  type CoachLessonDetail,
  type CoachNoteResponse,
  type CoachScheduleItem,
  type CoachStats,
  type CoachWeekScheduleResponse,
  type LessonLocation,
  type LessonResponse,
  type MonthAvailabilityResponse,
  type UpcomingLesson,
  type UpcomingLessonsResponse,
  type WeekAvailabilityResponse,
} from "@swim-app/shared";

import { loadError, loadOk, type LoadResult } from "@/lib/loadResult";

export type { UpcomingLessonsResponse };

export async function fetchLocations(accessToken: string): Promise<LoadResult<LessonLocation[]>> {
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/locations`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return loadError("server");
    const body: unknown = await response.json();
    const parsed = LessonLocationSchema.array().safeParse(body);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((issue) => `${issue.path.join(".")} (${issue.message})`).join("; ");
      console.warn(`fetchLocations: response shape mismatch — ${detail}`);
      return loadError("schema");
    }
    return loadOk(parsed.data);
  } catch {
    return loadError("network");
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
      const detail = parsed.error.issues.map((issue) => `${issue.path.join(".")} (${issue.message})`).join("; ");
      console.warn(`fetchAvailableSlots: response shape mismatch — ${detail}`);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

export async function coachGetPendingLessons(
  accessToken: string,
): Promise<LoadResult<LessonResponse[]>> {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/coach/lessons?status=pending`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    if (!response.ok) return loadError("server");
    const body: unknown = await response.json();
    const parsed = LessonResponseSchema.array().safeParse(body);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((issue) => `${issue.path.join(".")} (${issue.message})`).join("; ");
      console.warn(`coachGetPendingLessons: response shape mismatch — ${detail}`);
      return loadError("schema");
    }
    return loadOk(parsed.data);
  } catch {
    return loadError("network");
  }
}

export async function fetchCoachSchedule(
  accessToken: string,
  date: string,
): Promise<LoadResult<CoachScheduleItem[]>> {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/coach/schedule?date=${date}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      },
    );
    if (!response.ok) return loadError("server");
    const body: unknown = await response.json();
    const parsed = CoachScheduleItemSchema.array().safeParse(body);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((issue) => `${issue.path.join(".")} (${issue.message})`).join("; ");
      console.warn(`fetchCoachSchedule: response shape mismatch — ${detail}`);
      return loadError("schema");
    }
    return loadOk(parsed.data);
  } catch {
    return loadError("network");
  }
}

export async function fetchCoachWeekSchedule(
  accessToken: string,
  startDate: string,
): Promise<LoadResult<CoachWeekScheduleResponse>> {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/coach/schedule/week?startDate=${startDate}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      },
    );
    if (!response.ok) return loadError("server");
    const body: unknown = await response.json();
    const parsed = CoachWeekScheduleResponseSchema.safeParse(body);
    if (!parsed.success) {
      console.warn("fetchCoachWeekSchedule: response shape mismatch");
      return loadError("schema");
    }
    return loadOk(parsed.data);
  } catch {
    return loadError("network");
  }
}

export type FetchCoachLessonResult =
  | { ok: true; lesson: CoachLessonDetail }
  | { ok: false; status: number };

export async function fetchCoachLesson(
  accessToken: string,
  lessonId: string,
): Promise<FetchCoachLessonResult> {
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/coach/lessons/${lessonId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!response.ok) return { ok: false, status: response.status };
    const body: unknown = await response.json();
    const parsed = CoachLessonDetailSchema.safeParse(body);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((issue) => `${issue.path.join(".")} (${issue.message})`).join("; ");
      console.warn(`fetchCoachLesson: response shape mismatch — ${detail}`);
      return { ok: false, status: 500 };
    }
    return { ok: true, lesson: parsed.data };
  } catch {
    return { ok: false, status: 500 };
  }
}

export type FetchCoachBatchResult =
  | { ok: true; batch: CoachBatchDetail }
  | { ok: false; status: number };

export async function fetchCoachBatch(
  accessToken: string,
  batchId: string,
): Promise<FetchCoachBatchResult> {
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/coach/batches/${batchId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!response.ok) return { ok: false, status: response.status };
    const body: unknown = await response.json();
    const parsed = CoachBatchDetailSchema.safeParse(body);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((issue) => `${issue.path.join(".")} (${issue.message})`).join("; ");
      console.warn(`fetchCoachBatch: response shape mismatch — ${detail}`);
      return { ok: false, status: 500 };
    }
    return { ok: true, batch: parsed.data };
  } catch {
    return { ok: false, status: 500 };
  }
}

export async function fetchLessonNotes(
  accessToken: string,
  lessonId: string,
): Promise<LoadResult<CoachNoteResponse[]>> {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/coach/lessons/${lessonId}/notes`,
      { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" },
    );
    if (!response.ok) return loadError("server");
    const body: unknown = await response.json();
    const parsed = CoachNoteResponseSchema.array().safeParse(body);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((issue) => `${issue.path.join(".")} (${issue.message})`).join("; ");
      console.warn(`fetchLessonNotes: response shape mismatch — ${detail}`);
      return loadError("schema");
    }
    return loadOk(parsed.data);
  } catch {
    return loadError("network");
  }
}

export async function fetchCoachStats(accessToken: string): Promise<LoadResult<CoachStats>> {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/coach/stats`,
      { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" },
    );
    if (!response.ok) return loadError("server");
    const body: unknown = await response.json();
    const parsed = CoachStatsSchema.safeParse(body);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((issue) => `${issue.path.join(".")} (${issue.message})`).join("; ");
      console.warn(`fetchCoachStats: response shape mismatch — ${detail}`);
      return loadError("schema");
    }
    return loadOk(parsed.data);
  } catch {
    return loadError("network");
  }
}

export async function fetchUpcomingLessons(
  accessToken: string,
  params?: { limit?: number; offset?: number },
): Promise<LoadResult<UpcomingLessonsResponse>> {
  try {
    const searchParams = new URLSearchParams();
    if (params?.limit !== undefined) searchParams.set("limit", String(params.limit));
    if (params?.offset !== undefined) searchParams.set("offset", String(params.offset));
    const qs = searchParams.size > 0 ? `?${searchParams.toString()}` : "";
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/lessons${qs}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      },
    );
    if (!response.ok) {
      console.warn(`fetchUpcomingLessons: non-2xx response — ${response.status}`);
      return loadError("server");
    }
    const body: unknown = await response.json();
    const parsed = UpcomingLessonsResponseSchema.safeParse(body);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((issue) => `${issue.path.join(".")} (${issue.message})`).join("; ");
      console.warn(`fetchUpcomingLessons: response shape mismatch — ${detail}`);
      return loadError("schema");
    }
    return loadOk(parsed.data);
  } catch (error) {
    console.warn("fetchUpcomingLessons: network error —", error);
    return loadError("network");
  }
}

export async function fetchBatchCancelableLessons(
  accessToken: string,
  batchId: string,
): Promise<LoadResult<UpcomingLesson[]>> {
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/lessons/batch/${batchId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!response.ok) return loadError("server");
    const body: unknown = await response.json();
    const parsed = UpcomingLessonSchema.array().safeParse(body);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((issue) => `${issue.path.join(".")} (${issue.message})`).join("; ");
      console.warn(`fetchBatchCancelableLessons: response shape mismatch — ${detail}`);
      return loadError("schema");
    }
    return loadOk(parsed.data);
  } catch {
    return loadError("network");
  }
}

export type FetchLessonResult =
  | { ok: true; lesson: UpcomingLesson }
  | { ok: false; status: number };

export async function fetchLesson(
  accessToken: string,
  lessonId: string,
): Promise<FetchLessonResult> {
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/lessons/${lessonId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!response.ok) return { ok: false, status: response.status };
    const body: unknown = await response.json();
    const parsed = UpcomingLessonSchema.safeParse(body);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((issue) => `${issue.path.join(".")} (${issue.message})`).join("; ");
      console.warn(`fetchLesson: response shape mismatch — ${detail}`);
      return { ok: false, status: 500 };
    }
    return { ok: true, lesson: parsed.data };
  } catch {
    return { ok: false, status: 500 };
  }
}

export async function fetchPastLessons(
  accessToken: string,
): Promise<LoadResult<UpcomingLesson[]>> {
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/lessons?filter=past`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!response.ok) return loadError("server");
    const body: unknown = await response.json();
    const parsed = UpcomingLessonsResponseSchema.safeParse(body);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((issue) => `${issue.path.join(".")} (${issue.message})`).join("; ");
      console.warn(`fetchPastLessons: response shape mismatch — ${detail}`);
      return loadError("schema");
    }
    return loadOk(parsed.data.items);
  } catch {
    return loadError("network");
  }
}

export async function fetchPastLessonsResult(
  accessToken: string,
): Promise<LoadResult<UpcomingLesson[]>> {
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/lessons?filter=past`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!response.ok) return loadError("server");
    const body: unknown = await response.json();
    const parsed = UpcomingLessonsResponseSchema.safeParse(body);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((issue) => `${issue.path.join(".")} (${issue.message})`)
        .join("; ");
      console.warn(`fetchPastLessonsResult: response shape mismatch — ${detail}`);
      return loadError("schema");
    }
    return loadOk(parsed.data.items);
  } catch {
    return loadError("network");
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

export async function fetchRangeAvailability(
  accessToken: string,
  params: {
    view: "week" | "month";
    date: string;
    durationMinutes: 30 | 45 | 60;
    locationId: string;
    excludeLessonId?: string;
    // Coach-only: ask the server to skip the 16-hour notice rule. Server
    // silently drops the flag for non-coaches.
    coachBypassNotice?: boolean;
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
    if (params.coachBypassNotice) {
      searchParams.set("coachBypassNotice", "true");
    }
    const response = await fetch(
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
