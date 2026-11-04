import { ClubSchema, type Club } from "@swim-app/shared";

import { loadError, loadOk, type LoadResult } from "@/lib/loadResult";

export async function fetchClubs(accessToken: string): Promise<LoadResult<Club[]>> {
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/clubs`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return loadError("server");
    const body: unknown = await response.json();
    const parsed = ClubSchema.array().safeParse(body);
    if (!parsed.success) {
      console.warn("fetchClubs: 200 response did not match ClubSchema");
      return loadError("schema");
    }
    return loadOk(parsed.data);
  } catch {
    return loadError("network");
  }
}
