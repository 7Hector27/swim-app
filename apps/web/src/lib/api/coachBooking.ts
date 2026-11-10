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

import { loadError, loadOk, type LoadResult } from "@/lib/loadResult";

// Coach-specific locations fetch. The parent endpoint (/locations) is behind
// requireParent and 403s for coaches; /coach/locations returns every named
// pool (home pools live per-household and come from the household lookup).
export async function fetchCoachLocations(
  accessToken: string,
): Promise<LoadResult<LessonLocation[]>> {
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/coach/locations`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return loadError("server");
    const body: unknown = await response.json();
    const parsed = LessonLocationSchema.array().safeParse(body);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((issue) => `${issue.path.join(".")} (${issue.message})`)
        .join("; ");
      console.warn(`fetchCoachLocations: response shape mismatch — ${detail}`);
      return loadError("schema");
    }
    return loadOk(parsed.data);
  } catch {
    return loadError("network");
  }
}

export async function fetchCoachHouseholds(
  accessToken: string,
  params: { q?: string; householdId?: string; limit?: number },
): Promise<LoadResult<CoachHouseholdSearchResponse>> {
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
    if (!response.ok) return loadError("server");
    const body: unknown = await response.json();
    const parsed = CoachHouseholdSearchResponseSchema.safeParse(body);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((issue) => `${issue.path.join(".")} (${issue.message})`)
        .join("; ");
      console.warn(`fetchCoachHouseholds: response shape mismatch — ${detail}`);
      return loadError("schema");
    }
    return loadOk(parsed.data);
  } catch {
    return loadError("network");
  }
}

export type CoachCreateLessonResult =
  | { kind: "created"; lesson: LessonResponse }
  | { kind: "warnings"; body: CoachCreateLessonWarningsResponse }
  | { kind: "slot_unavailable" }
  | {
      kind: "insufficient_balance";
      balanceCents: number;
      priceCents: number;
      shortfallCents: number;
    }
  | { kind: "error"; message: string };

function readCoachInsufficientBalance(
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

  if (responseStatus === 422) {
    // Map 422 by error code — insufficient_balance and slot_unavailable
    // both land on 422, so the status alone is ambiguous.
    const shortfall = readCoachInsufficientBalance(responseBody);
    if (shortfall !== null) {
      return { kind: "insufficient_balance", ...shortfall };
    }
    if (
      typeof responseBody === "object" &&
      responseBody !== null &&
      "error" in responseBody &&
      (responseBody as { error: unknown }).error === "slot_unavailable"
    ) {
      return { kind: "slot_unavailable" };
    }
  }

  const message =
    typeof responseBody === "object" && responseBody !== null && "error" in responseBody
      ? String((responseBody as { error: unknown }).error)
      : `Request failed (${responseStatus}).`;
  return { kind: "error", message };
}
