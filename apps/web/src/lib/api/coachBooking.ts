import {
  CoachCreateLessonBodySchema,
  CoachCreateLessonWarningsResponseSchema,
  CoachHouseholdSearchResponseSchema,
  LessonLocationSchema,
  LessonResponseSchema,
  type CoachCreateLessonBody,
  type CoachCreateLessonWarningsResponse,
  type CoachHouseholdSearchResponse,
  type LessonLocation,
  type LessonResponse,
} from "@swim-app/shared";

// Coach-specific locations fetch. The parent endpoint (/locations) is behind
// requireParent and 403s for coaches; /coach/locations returns every named
// pool (home pools live per-household and come from the household lookup).
export async function fetchCoachLocations(accessToken: string): Promise<LessonLocation[]> {
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/coach/locations`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return [];
    const body: unknown = await response.json();
    const parsed = LessonLocationSchema.array().safeParse(body);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((issue) => `${issue.path.join(".")} (${issue.message})`)
        .join("; ");
      console.warn(`fetchCoachLocations: response shape mismatch — ${detail}`);
      return [];
    }
    return parsed.data;
  } catch {
    return [];
  }
}

export async function fetchCoachHouseholds(
  accessToken: string,
  params: { q?: string; householdId?: string; limit?: number },
): Promise<CoachHouseholdSearchResponse | null> {
  try {
    const search = new URLSearchParams();
    if (params.q) search.set("q", params.q);
    if (params.householdId) search.set("householdId", params.householdId);
    if (params.limit !== undefined) search.set("limit", String(params.limit));
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL}/coach/households?${search.toString()}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      },
    );
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const parsed = CoachHouseholdSearchResponseSchema.safeParse(body);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((issue) => `${issue.path.join(".")} (${issue.message})`)
        .join("; ");
      console.warn(`fetchCoachHouseholds: response shape mismatch — ${detail}`);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

export type CoachCreateLessonResult =
  | { kind: "created"; lesson: LessonResponse }
  | { kind: "warnings"; body: CoachCreateLessonWarningsResponse }
  | { kind: "slot_unavailable" }
  | { kind: "error"; message: string };

export async function createCoachLesson(
  accessToken: string,
  body: CoachCreateLessonBody,
): Promise<CoachCreateLessonResult> {
  const parsed = CoachCreateLessonBodySchema.safeParse(body);
  if (!parsed.success) {
    return { kind: "error", message: "Invalid request. Please start over." };
  }

  let responseStatus: number;
  let responseBody: unknown = null;
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/coach/lessons`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
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
    return { kind: "error", message: "Could not reach the server. Please try again." };
  }

  if (responseStatus === 201) {
    const lesson = LessonResponseSchema.safeParse(responseBody);
    if (!lesson.success) {
      return { kind: "error", message: "Booked, but response shape was unexpected." };
    }
    return { kind: "created", lesson: lesson.data };
  }

  if (responseStatus === 409) {
    const warnings = CoachCreateLessonWarningsResponseSchema.safeParse(responseBody);
    if (warnings.success) return { kind: "warnings", body: warnings.data };
    return { kind: "error", message: "Server reported warnings but the payload was unexpected." };
  }

  if (
    responseStatus === 422 &&
    typeof responseBody === "object" &&
    responseBody !== null &&
    "error" in responseBody &&
    (responseBody as { error: unknown }).error === "slot_unavailable"
  ) {
    return { kind: "slot_unavailable" };
  }

  const message =
    typeof responseBody === "object" && responseBody !== null && "error" in responseBody
      ? String((responseBody as { error: unknown }).error)
      : `Request failed (${responseStatus}).`;
  return { kind: "error", message };
}
