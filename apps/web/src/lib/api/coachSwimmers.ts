import {
  CoachSwimmerSchema,
  CoachSwimmerDetailSchema,
  type CoachSwimmer,
  type CoachSwimmerDetail,
} from "@swim-app/shared";

export async function fetchCoachSwimmers(accessToken: string): Promise<CoachSwimmer[]> {
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/coach/swimmers`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return [];
    const body: unknown = await response.json();
    const parsed = CoachSwimmerSchema.array().safeParse(body);
    if (!parsed.success) {
      console.warn("fetchCoachSwimmers: 200 response did not match CoachSwimmerSchema");
      return [];
    }
    return parsed.data;
  } catch {
    return [];
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
