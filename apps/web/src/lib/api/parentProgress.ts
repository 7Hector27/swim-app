import {
  ParentPersonalBestsResponseSchema,
  type ParentPersonalBestsResponse,
  ParentScoreHistoryResponseSchema,
  type ParentScoreHistoryResponse,
  ParentSwimmerProgressResponseSchema,
  type ParentSwimmerProgressResponse,
  ParentSwimmerSchema,
  type ParentSwimmer,
  ParentSwimmerSummariesResponseSchema,
  type ParentSwimmerSummariesResponse,
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
  | { ok: true; data: ParentScoreHistoryResponse }
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
    // Strict parent-facing schema: `.strict()` rejects any extra keys, so
    // a `faultTrends` field slipping into the response trips here instead
    // of silently reaching a parent component.
    const parsed = ParentScoreHistoryResponseSchema.safeParse(body);
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

export type FetchParentSwimmerSummariesResult =
  | { ok: true; data: ParentSwimmerSummariesResponse }
  | { ok: false; status: number };

export async function fetchParentSwimmerSummaries(
  accessToken: string,
): Promise<FetchParentSwimmerSummariesResult> {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/swimmers/me/summary`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!response.ok) return { ok: false, status: response.status };
    const body: unknown = await response.json();
    const parsed = ParentSwimmerSummariesResponseSchema.safeParse(body);
    if (!parsed.success) return { ok: false, status: 500 };
    return { ok: true, data: parsed.data };
  } catch {
    return { ok: false, status: 500 };
  }
}
