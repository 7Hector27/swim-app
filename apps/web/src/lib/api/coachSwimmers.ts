import {
  CoachSwimmerSchema,
  CoachSwimmerDetailSchema,
  TimelineResponseSchema,
  type CoachSwimmer,
  type CoachSwimmerDetail,
  type TimelineResponse,
} from "@swim-app/shared";

import { loadError, loadOk, type LoadResult } from "@/lib/loadResult";

export async function fetchCoachSwimmers(
  accessToken: string,
): Promise<LoadResult<CoachSwimmer[]>> {
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/coach/swimmers`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return loadError("server");
    const body: unknown = await response.json();
    const parsed = CoachSwimmerSchema.array().safeParse(body);
    if (!parsed.success) {
      console.warn("fetchCoachSwimmers: 200 response did not match CoachSwimmerSchema");
      return loadError("schema");
    }
    return loadOk(parsed.data);
  } catch {
    return loadError("network");
  }
}

export type FetchSwimmerTimelineResult =
  | { ok: true; items: TimelineResponse }
  | { ok: false; status: number };

export async function fetchSwimmerTimeline(
  swimmerId: string,
  accessToken: string,
): Promise<FetchSwimmerTimelineResult> {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/coach/swimmers/${swimmerId}/timeline`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!response.ok) return { ok: false, status: response.status };
    const body: unknown = await response.json();
    const parsed = TimelineResponseSchema.safeParse(body);
    if (!parsed.success) {
      console.warn("fetchSwimmerTimeline: 200 response did not match TimelineResponseSchema");
      return { ok: false, status: 500 };
    }
    return { ok: true, items: parsed.data };
  } catch {
    return { ok: false, status: 500 };
  }
}

export type FetchCoachSwimmerDetailResult =
  | { ok: true; swimmer: CoachSwimmerDetail }
  | { ok: false; status: number };

export async function fetchCoachSwimmerDetail(
  swimmerId: string,
  accessToken: string,
): Promise<FetchCoachSwimmerDetailResult> {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/coach/swimmers/${swimmerId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!response.ok) return { ok: false, status: response.status };
    const body: unknown = await response.json();
    const parsed = CoachSwimmerDetailSchema.safeParse(body);
    if (!parsed.success) {
      console.warn("fetchCoachSwimmerDetail: 200 response did not match CoachSwimmerDetailSchema");
      return { ok: false, status: 500 };
    }
    return { ok: true, swimmer: parsed.data };
  } catch {
    return { ok: false, status: 500 };
  }
}
