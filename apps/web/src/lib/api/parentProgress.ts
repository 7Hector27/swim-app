import {
  ParentPersonalBestsResponseSchema,
  type ParentPersonalBestsResponse,
  ParentSwimmerProgressResponseSchema,
  type ParentSwimmerProgressResponse,
  ParentSwimmerSchema,
  type ParentSwimmer,
  ScoreHistoryResponseSchema,
  type ScoreHistoryResponse,
} from "@swim-app/shared";

export type FetchParentSwimmerProgressResult =
  | { ok: true; data: ParentSwimmerProgressResponse }
  | { ok: false; status: number };

export async function fetchParentSwimmerProgress(
  swimmerId: string,
  accessToken: string,
): Promise<FetchParentSwimmerProgressResult> {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/swimmers/${swimmerId}/progress`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!response.ok) return { ok: false, status: response.status };
    const body: unknown = await response.json();
    const parsed = ParentSwimmerProgressResponseSchema.safeParse(body);
    if (!parsed.success) return { ok: false, status: 500 };
    return { ok: true, data: parsed.data };
  } catch {
    return { ok: false, status: 500 };
  }
}

export type FetchParentSwimmerResult =
  | { ok: true; swimmer: ParentSwimmer }
  | { ok: false; status: number };

export async function fetchParentSwimmer(
  swimmerId: string,
  accessToken: string,
): Promise<FetchParentSwimmerResult> {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/swimmers/${swimmerId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!response.ok) return { ok: false, status: response.status };
    const body: unknown = await response.json();
    const parsed = ParentSwimmerSchema.safeParse(body);
    if (!parsed.success) return { ok: false, status: 500 };
    return { ok: true, swimmer: parsed.data };
  } catch {
    return { ok: false, status: 500 };
  }
}

export type FetchParentScoreHistoryResult =
  | { ok: true; data: ScoreHistoryResponse }
  | { ok: false; status: number };

export async function fetchParentScoreHistory(
  swimmerId: string,
  accessToken: string,
): Promise<FetchParentScoreHistoryResult> {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/swimmers/${swimmerId}/score-history`,
      { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" },
    );
    if (!response.ok) return { ok: false, status: response.status };
    const body: unknown = await response.json();
    const parsed = ScoreHistoryResponseSchema.safeParse(body);
    if (!parsed.success) return { ok: false, status: 500 };
    return { ok: true, data: parsed.data };
  } catch {
    return { ok: false, status: 500 };
  }
}

export type FetchParentPersonalBestsResult =
  | { ok: true; data: ParentPersonalBestsResponse }
  | { ok: false; status: number };

export async function fetchParentPersonalBests(
  swimmerId: string,
  accessToken: string,
): Promise<FetchParentPersonalBestsResult> {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/swimmers/${swimmerId}/personal-bests`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!response.ok) return { ok: false, status: response.status };
    const body: unknown = await response.json();
    const parsed = ParentPersonalBestsResponseSchema.safeParse(body);
    if (!parsed.success) return { ok: false, status: 500 };
    return { ok: true, data: parsed.data };
  } catch {
    return { ok: false, status: 500 };
  }
}
