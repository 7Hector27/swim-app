"use server";

import { createClient } from "@/lib/supabase/server";
import { fetchRangeAvailability, fetchAvailableSlots } from "@/lib/api/lessons";
import {
  type AvailableSlot,
  BatchPreviewResponseSchema,
  BatchSubmitConflictResponseSchema,
  BatchSubmitSuccessResponseSchema,
  type BatchPreviewBody,
  type BatchPreviewResponse,
  type BatchSubmitBody,
  type BatchSubmitConflictResponse,
  type BatchSubmitSuccessResponse,
  CreateLessonBodySchema,
  LessonResponseSchema,
  MonthAvailabilityResponseSchema,
  WeekAvailabilityResponseSchema,
  type MonthAvailabilityResponse,
  type WeekAvailabilityResponse,
} from "@swim-app/shared";
import { mapBookingApiResponse, getMondayOfWeek, addDaysToDateStr, firstAvailableDayInWeek, type BookingState } from "./helpers";

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
  view: "week";
  date: string;
  durationMinutes: 30 | 45 | 60;
  locationId: string;
  excludeLessonId?: string;
  // Coach-only — ignored by the server for parent callers.
  coachBypassNotice?: boolean;
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

export async function fetchMonthRangeAction(params: {
  date: string;
  durationMinutes: 30 | 45 | 60;
  locationId: string;
  excludeLessonId?: string;
  coachBypassNotice?: boolean;
}): Promise<MonthAvailabilityResponse | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;
  const result = await fetchRangeAvailability(token, { view: "month", ...params });
  if (result === null) return null;
  const parsed = MonthAvailabilityResponseSchema.safeParse(result);
  return parsed.success ? parsed.data : null;
}

export async function findFirstAvailableDayAction(params: {
  fromDate: string;
  durationMinutes: 30 | 45 | 60;
  locationId: string;
  excludeLessonId?: string;
  coachBypassNotice?: boolean;
}): Promise<{
  firstAvailableDate: string | null;
  weekData: WeekAvailabilityResponse;
} | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;

  let searchFrom = params.fromDate;
  let firstWeekData: WeekAvailabilityResponse | null = null;

  for (let week = 0; week < 11; week++) {
    const monday = getMondayOfWeek(searchFrom);
    const result = await fetchRangeAvailability(token, {
      view: "week",
      date: monday,
      durationMinutes: params.durationMinutes,
      locationId: params.locationId,
      ...(params.excludeLessonId ? { excludeLessonId: params.excludeLessonId } : {}),
      ...(params.coachBypassNotice ? { coachBypassNotice: true } : {}),
    });
    if (result === null) return null;
    const parsed = WeekAvailabilityResponseSchema.safeParse(result);
    if (!parsed.success) return null;
    const weekData = parsed.data;

    if (week === 0) {
      firstWeekData = weekData;
    }

    const fromDate = week === 0 ? params.fromDate : monday;
    const firstAvailableDate = firstAvailableDayInWeek(weekData.days, fromDate);
    if (firstAvailableDate !== null) {
      return { firstAvailableDate, weekData };
    }

    const hasNotOpenYet = weekData.days.some((day) => day.dayState === "not_open_yet");
    if (hasNotOpenYet) break;

    searchFrom = addDaysToDateStr(monday, 7);
  }

  if (firstWeekData === null) return null;
  return { firstAvailableDate: null, weekData: firstWeekData };
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

  return mapBookingApiResponse(responseStatus, responseBody, {
    startsAt: parsed.data.startsAt,
    durationMinutes: parsed.data.durationMinutes,
    locationId: parsed.data.locationId,
    swimmerIds: parsed.data.swimmerIds,
  });
}

// ── Batch (ADR 030) ──────────────────────────────────────────────────────────

export type BatchPreviewResult =
  | { kind: "ok"; data: BatchPreviewResponse }
  | { kind: "forbidden" }
  | { kind: "error"; message: string };

export async function previewBatchAction(body: BatchPreviewBody): Promise<BatchPreviewResult> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { kind: "error", message: "Session expired. Please sign in again." };
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/lessons/batch/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    if (response.status === 403) return { kind: "forbidden" };
    if (!response.ok) {
      return { kind: "error", message: "Could not check availability. Please try again." };
    }
    const json: unknown = await response.json();
    const parsed = BatchPreviewResponseSchema.safeParse(json);
    if (!parsed.success) return { kind: "error", message: "Unexpected response from server." };
    return { kind: "ok", data: parsed.data };
  } catch {
    return { kind: "error", message: "Could not reach the server. Please try again." };
  }
}

export type BatchSubmitResult =
  | { kind: "ok"; data: BatchSubmitSuccessResponse }
  | { kind: "conflict"; data: BatchSubmitConflictResponse }
  | {
      kind: "insufficient_balance";
      balanceCents: number;
      priceCents: number;
      shortfallCents: number;
    }
  | { kind: "forbidden" }
  | { kind: "error"; message: string };

function readInsufficientBalanceBody(
  body: unknown,
):
  | { balanceCents: number; priceCents: number; shortfallCents: number }
  | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  if (record.error !== "insufficient_balance") return null;
  if (
    typeof record.balanceCents !== "number" ||
    typeof record.priceCents !== "number" ||
    typeof record.shortfallCents !== "number"
  ) {
    return null;
  }
  return {
    balanceCents: record.balanceCents,
    priceCents: record.priceCents,
    shortfallCents: record.shortfallCents,
  };
}

export async function submitBatchAction(body: BatchSubmitBody): Promise<BatchSubmitResult> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { kind: "error", message: "Session expired. Please sign in again." };
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/lessons/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    if (response.status === 403) return { kind: "forbidden" };
    if (response.status === 422) {
      // Both insufficient_balance and picks_conflict ride on 422, so map by
      // the error code — not the status — to avoid mislabeling a payment
      // problem as an availability conflict.
      const json: unknown = await response.json().catch(() => null);
      const shortfall = readInsufficientBalanceBody(json);
      if (shortfall !== null) {
        return { kind: "insufficient_balance", ...shortfall };
      }
      const parsed = BatchSubmitConflictResponseSchema.safeParse(json);
      if (parsed.success) return { kind: "conflict", data: parsed.data };
      return { kind: "error", message: "Could not book your lessons. Please try again." };
    }
    if (response.status === 201) {
      const json: unknown = await response.json();
      const parsed = BatchSubmitSuccessResponseSchema.safeParse(json);
      if (!parsed.success) return { kind: "error", message: "Unexpected response from server." };
      return { kind: "ok", data: parsed.data };
    }
    return { kind: "error", message: "Could not book your lessons. Please try again." };
  } catch {
    return { kind: "error", message: "Could not reach the server. Please try again." };
  }
}
