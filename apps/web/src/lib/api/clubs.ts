import { ClubSchema, type Club } from "@swim-app/shared";

export async function fetchClubs(accessToken: string): Promise<Club[]> {
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/clubs`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return [];
    const body: unknown = await response.json();
    const parsed = ClubSchema.array().safeParse(body);
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}
