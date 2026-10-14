import {
  AvailableSlotSchema,
  LessonLocationSchema,
  LessonResponseSchema,
  type AvailableSlot,
  type LessonLocation,
  type LessonResponse,
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
): Promise<AvailableSlot[]> {
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
    if (!response.ok) return [];
    const body: unknown = await response.json();
    const parsed = AvailableSlotSchema.array().safeParse(body);
    if (!parsed.success) {
      console.warn("fetchAvailableSlots: 200 response did not match AvailableSlotSchema.array()");
      return [];
    }
    return parsed.data;
  } catch {
    return [];
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
