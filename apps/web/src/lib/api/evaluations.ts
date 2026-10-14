import {
  CategoriesResponseSchema,
  type CategoriesResponse,
  CoachSkillRatingSchema,
  type CoachSkillRating,
  type StartGradeResult,
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

type SwimmerSkillsResponse = {
  grades: Record<string, number | "not_legal" | "no_concept">;
  startGrades: Record<string, StartGradeResult>;
  coachingPriorities: Array<{ targetSlug: string; chain: Array<{ slug: string; grade: unknown; sortOrder: number }> }>;
};

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
    const body = await response.json() as SwimmerSkillsResponse;
    return { ok: true, data: body };
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
