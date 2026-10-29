import {
  CategoriesResponseSchema,
  type CategoriesResponse,
  ScreensResponseSchema,
  type ScreensResponse,
  CoachSkillRatingSchema,
  type CoachSkillRating,
  SwimmerSkillsResponseSchema,
  type SwimmerSkillsResponse,
  SwimmerProgressResponseSchema,
  type SwimmerProgressResponse,
  GolfScoreTrendsResponseSchema,
  type GolfScoreTrendsResponse,
  ScoreHistoryResponseSchema,
  type ScoreHistoryResponse,
  GetSessionResponseSchema,
  type GetSessionResponse,
  PatchSessionResponseSchema,
  type PatchSessionBody,
  type PatchSessionResponse,
  GetEvaluationsResponseSchema,
  type GetEvaluationsResponse,
} from "@swim-app/shared";

export type FetchCategoriesResult =
  | { ok: true; categories: CategoriesResponse }
  | { ok: false; status: number };

export async function fetchSkillCategories(
  accessToken: string,
): Promise<FetchCategoriesResult> {
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/coach/categories`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return { ok: false, status: response.status };
    const body: unknown = await response.json();
    const parsed = CategoriesResponseSchema.safeParse(body);
    if (!parsed.success) return { ok: false, status: 500 };
    return { ok: true, categories: parsed.data };
  } catch {
    return { ok: false, status: 500 };
  }
}

export type FetchScreensResult =
  | { ok: true; screens: ScreensResponse }
  | { ok: false; status: number };

export async function fetchScreens(
  accessToken: string,
): Promise<FetchScreensResult> {
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/coach/screens`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return { ok: false, status: response.status };
    const body: unknown = await response.json();
    const parsed = ScreensResponseSchema.safeParse(body);
    if (!parsed.success) return { ok: false, status: 500 };
    return { ok: true, screens: parsed.data };
  } catch {
    return { ok: false, status: 500 };
  }
}

export type FetchSkillRatingHistoryResult =
  | { ok: true; ratings: CoachSkillRating[] }
  | { ok: false; status: number };

export async function fetchSkillRatingHistory(
  swimmerId: string,
  skillId: string,
  accessToken: string,
): Promise<FetchSkillRatingHistoryResult> {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/coach/swimmers/${swimmerId}/skills/${skillId}/ratings`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!response.ok) return { ok: false, status: response.status };
    const body: unknown = await response.json();
    const parsed = CoachSkillRatingSchema.array().safeParse(body);
    if (!parsed.success) return { ok: false, status: 500 };
    return { ok: true, ratings: parsed.data };
  } catch {
    return { ok: false, status: 500 };
  }
}

export type FetchSwimmerSkillsResult =
  | { ok: true; data: SwimmerSkillsResponse }
  | { ok: false; status: number };

export async function fetchSwimmerSkills(
  swimmerId: string,
  accessToken: string,
): Promise<FetchSwimmerSkillsResult> {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/coach/swimmers/${swimmerId}/skills`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!response.ok) return { ok: false, status: response.status };
    const body: unknown = await response.json();
    const parsed = SwimmerSkillsResponseSchema.safeParse(body);
    if (!parsed.success) return { ok: false, status: 500 };
    return { ok: true, data: parsed.data };
  } catch {
    return { ok: false, status: 500 };
  }
}

export type FetchSwimmerProgressResult =
  | { ok: true; data: SwimmerProgressResponse }
  | { ok: false; status: number };

export async function fetchSwimmerProgress(
  swimmerId: string,
  accessToken: string,
): Promise<FetchSwimmerProgressResult> {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/coach/swimmers/${swimmerId}/progress`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!response.ok) return { ok: false, status: response.status };
    const body: unknown = await response.json();
    const parsed = SwimmerProgressResponseSchema.safeParse(body);
    if (!parsed.success) return { ok: false, status: 500 };
    return { ok: true, data: parsed.data };
  } catch {
    return { ok: false, status: 500 };
  }
}

export type FetchGolfScoreTrendsResult =
  | { ok: true; data: GolfScoreTrendsResponse }
  | { ok: false; status: number };

export async function fetchGolfScoreTrends(
  swimmerId: string,
  accessToken: string,
): Promise<FetchGolfScoreTrendsResult> {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_API_URL}/coach/swimmers/${swimmerId}/golf-score-trends`,
    { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" },
  );
  if (!res.ok) return { ok: false, status: res.status };
  const body: unknown = await res.json();
  const parsed = GolfScoreTrendsResponseSchema.safeParse(body);
  if (!parsed.success) return { ok: false, status: 200 };
  return { ok: true, data: parsed.data };
}

export type FetchScoreHistoryResult =
  | { ok: true; data: ScoreHistoryResponse }
  | { ok: false; status: number };

export async function fetchScoreHistory(
  swimmerId: string,
  accessToken: string,
): Promise<FetchScoreHistoryResult> {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/coach/swimmers/${swimmerId}/score-history`,
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

export type FetchSessionResult =
  | { ok: true; data: GetSessionResponse }
  | { ok: false; status: number };

export async function fetchSession(
  sessionId: string,
  accessToken: string,
): Promise<FetchSessionResult> {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/coach/sessions/${sessionId}`,
      { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" },
    );
    if (!response.ok) return { ok: false, status: response.status };
    const body: unknown = await response.json();
    const parsed = GetSessionResponseSchema.safeParse(body);
    if (!parsed.success) return { ok: false, status: 500 };
    return { ok: true, data: parsed.data };
  } catch {
    return { ok: false, status: 500 };
  }
}

export type PatchSessionResult =
  | { ok: true; data: PatchSessionResponse }
  // 409 means a submitted ratingId was superseded by another tab between the
  // GET and the PATCH; the caller should refetch and resubmit.
  | { ok: false; status: number };

export async function patchSession(
  sessionId: string,
  body: PatchSessionBody,
  accessToken: string,
): Promise<PatchSessionResult> {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/coach/sessions/${sessionId}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
    if (!response.ok) return { ok: false, status: response.status };
    const payload: unknown = await response.json();
    const parsed = PatchSessionResponseSchema.safeParse(payload);
    if (!parsed.success) return { ok: false, status: 500 };
    return { ok: true, data: parsed.data };
  } catch {
    return { ok: false, status: 500 };
  }
}

export type FetchSwimmerEvaluationsResult =
  | { ok: true; data: GetEvaluationsResponse }
  | { ok: false; status: number };

export async function fetchSwimmerEvaluations(
  swimmerId: string,
  accessToken: string,
  options: { cursor?: string; limit?: number } = {},
): Promise<FetchSwimmerEvaluationsResult> {
  try {
    const params = new URLSearchParams();
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    if (options.cursor !== undefined) params.set("cursor", options.cursor);
    const query = params.toString();
    const url = `${process.env.NEXT_PUBLIC_API_URL}/coach/swimmers/${swimmerId}/evaluations${query ? `?${query}` : ""}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!response.ok) return { ok: false, status: response.status };
    const body: unknown = await response.json();
    const parsed = GetEvaluationsResponseSchema.safeParse(body);
    if (!parsed.success) return { ok: false, status: 500 };
    return { ok: true, data: parsed.data };
  } catch {
    return { ok: false, status: 500 };
  }
}

export type VoidRatingResult = { ok: true } | { ok: false; status: number };

export async function voidRating(
  ratingId: string,
  reason: string,
  accessToken: string,
): Promise<VoidRatingResult> {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/coach/ratings/${ratingId}/void`,
      {
        method: "PATCH",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      },
    );
    if (!response.ok) return { ok: false, status: response.status };
    return { ok: true };
  } catch {
    return { ok: false, status: 500 };
  }
}
