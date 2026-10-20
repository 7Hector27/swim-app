import {
  PublicBoardResponseSchema,
  PublicMasterResponseSchema,
  type PublicBoardResponse,
  type PublicMasterResponse,
} from "@swim-app/shared";

import { apiFetch } from "./apiFetch";

function buildQueryString(rawParams: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(rawParams)) {
    if (value !== undefined && value !== "") {
      params.set(key, value);
    }
  }
  const queryString = params.toString();
  return queryString ? `?${queryString}` : "";
}

export async function fetchClubBoard(
  rawParams: Record<string, string | undefined>,
): Promise<PublicBoardResponse | null> {
  try {
    const response = await apiFetch(
      `${process.env.NEXT_PUBLIC_API_URL}/leaderboard/club${buildQueryString(rawParams)}`,
      { next: { revalidate: 60 } },
    );
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const parsed = PublicBoardResponseSchema.safeParse(body);
    if (!parsed.success) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

export async function fetchISLBoard(
  rawParams: Record<string, string | undefined>,
): Promise<PublicBoardResponse | null> {
  try {
    const response = await apiFetch(
      `${process.env.NEXT_PUBLIC_API_URL}/leaderboard/isl${buildQueryString(rawParams)}`,
      { next: { revalidate: 60 } },
    );
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const parsed = PublicBoardResponseSchema.safeParse(body);
    if (!parsed.success) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

export async function fetchMasterBoard(
  rawParams: Record<string, string | undefined>,
): Promise<PublicMasterResponse | null> {
  try {
    const response = await apiFetch(
      `${process.env.NEXT_PUBLIC_API_URL}/leaderboard/master${buildQueryString(rawParams)}`,
      { next: { revalidate: 60 } },
    );
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const parsed = PublicMasterResponseSchema.safeParse(body);
    if (!parsed.success) return null;
    return parsed.data;
  } catch {
    return null;
  }
}
