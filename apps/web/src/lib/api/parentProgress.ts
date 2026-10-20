import { apiFetch } from "./apiFetch";

import {
  ParentSwimmerProgressResponseSchema,
  type ParentSwimmerProgressResponse,
  ParentSwimmerSchema,
  type ParentSwimmer,
} from "@swim-app/shared";

export type FetchParentSwimmerProgressResult =
  | { ok: true; data: ParentSwimmerProgressResponse }
  | { ok: false; status: number };

export async function fetchParentSwimmerProgress(
  swimmerId: string,
  accessToken: string,
): Promise<FetchParentSwimmerProgressResult> {
  try {
    const response = await apiFetch(
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
    const response = await apiFetch(
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
