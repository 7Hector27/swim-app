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
