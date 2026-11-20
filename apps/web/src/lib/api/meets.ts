import {
  MeetResponseSchema,
  MeetWithSwimsResponseSchema,
  MeetSwimsResponseSchema,
  SwimmerBestsResponseSchema,
  type MeetResponse,
  type MeetWithSwimsResponse,
  type MeetSwimsResponse,
  type SwimmerBestsResponse,
} from "@swim-app/shared";

export type FetchMeetsResult = { ok: true; meets: MeetResponse[] } | { ok: false; status: number };

export async function fetchMeets(accessToken: string): Promise<FetchMeetsResult> {
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/coach/meets`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return { ok: false, status: response.status };
    const body: unknown = await response.json();
    const parsed = MeetResponseSchema.array().safeParse(body);
    if (!parsed.success) {
      console.warn("fetchMeets: 200 response did not match MeetResponseSchema");
      return { ok: false, status: 500 };
    }
    return { ok: true, meets: parsed.data };
  } catch {
    return { ok: false, status: 500 };
  }
}

export type FetchMeetDetailResult =
  | { ok: true; meet: MeetWithSwimsResponse }
  | { ok: false; status: number };

export async function fetchMeetDetail(
  meetId: string,
  accessToken: string,
): Promise<FetchMeetDetailResult> {
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/coach/meets/${meetId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return { ok: false, status: response.status };
    const body: unknown = await response.json();
    const parsed = MeetWithSwimsResponseSchema.safeParse(body);
    if (!parsed.success) {
      console.warn("fetchMeetDetail: 200 response did not match MeetWithSwimsResponseSchema");
      return { ok: false, status: 500 };
    }
    return { ok: true, meet: parsed.data };
  } catch {
    return { ok: false, status: 500 };
  }
}

export type FetchSwimmerMeetSwimsResult =
  | { ok: true; data: MeetSwimsResponse }
  | { ok: false; status: number };

export async function fetchSwimmerMeetSwims(
  swimmerId: string,
  accessToken: string,
): Promise<FetchSwimmerMeetSwimsResult> {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/coach/swimmers/${swimmerId}/meet-swims`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!response.ok) return { ok: false, status: response.status };
    const body: unknown = await response.json();
    const parsed = MeetSwimsResponseSchema.safeParse(body);
    if (!parsed.success) {
      console.warn("fetchSwimmerMeetSwims: 200 response did not match MeetSwimsResponseSchema");
      return { ok: false, status: 500 };
    }
    return { ok: true, data: parsed.data };
  } catch {
    return { ok: false, status: 500 };
  }
}

export type FetchSwimmerBestsResult =
  | { ok: true; data: SwimmerBestsResponse }
  | { ok: false; status: number };

export async function fetchAllSwimmerBests(
  accessToken: string,
): Promise<FetchSwimmerBestsResult> {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/coach/swimmers/bests/all`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!response.ok) return { ok: false, status: response.status };
    const body: unknown = await response.json();
    const parsed = SwimmerBestsResponseSchema.safeParse(body);
    if (!parsed.success) {
      console.warn("fetchAllSwimmerBests: 200 response did not match schema");
      return { ok: false, status: 500 };
    }
    return { ok: true, data: parsed.data };
  } catch {
    return { ok: false, status: 500 };
  }
}
