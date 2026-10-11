import { ParentSwimmerSchema, type ParentSwimmer } from "@swim-app/shared";

export async function fetchSwimmers(accessToken: string): Promise<ParentSwimmer[]> {
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/swimmers/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return [];
    const body: unknown = await response.json();
    const parsed = ParentSwimmerSchema.array().safeParse(body);
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}
