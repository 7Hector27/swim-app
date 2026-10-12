import { HouseholdResponseSchema, type HouseholdResponse } from "@swim-app/shared";

export async function fetchHousehold(accessToken: string): Promise<HouseholdResponse | null> {
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/households/mine`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const parsed = HouseholdResponseSchema.safeParse(body);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
