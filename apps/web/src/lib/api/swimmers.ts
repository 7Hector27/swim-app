import { ParentSwimmerSchema, type ParentSwimmer } from "@swim-app/shared";

import { loadError, loadOk, type LoadResult } from "@/lib/loadResult";

type FetchSwimmerResult =
  | { ok: true; swimmer: ParentSwimmer }
  | { ok: false; status: number };

export async function fetchSwimmer(
  id: string,
  accessToken: string,
): Promise<FetchSwimmerResult> {
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/swimmers/${id}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return { ok: false, status: response.status };
    const body: unknown = await response.json();
    const parsed = ParentSwimmerSchema.safeParse(body);
    if (!parsed.success) return { ok: false, status: 500 };
    return { ok: true, swimmer: parsed.data };
  } catch {
    return { ok: false, status: 500 };
  }
}

export async function fetchSwimmers(
  accessToken: string,
): Promise<LoadResult<ParentSwimmer[]>> {
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/swimmers/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return loadError("server");
    const body: unknown = await response.json();
    const parsed = ParentSwimmerSchema.array().safeParse(body);
    if (!parsed.success) {
      console.warn("fetchSwimmers: 200 response did not match ParentSwimmerSchema");
      return loadError("schema");
    }
    return loadOk(parsed.data);
  } catch {
    return loadError("network");
  }
}
