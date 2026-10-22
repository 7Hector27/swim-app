import {
  GoogleCalendarStatusResponseSchema,
  type GoogleCalendarStatusResponse,
} from "@swim-app/shared";

export async function fetchGoogleCalendarStatus(
  accessToken: string,
): Promise<GoogleCalendarStatusResponse | null> {
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/coach/calendar/status`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (response.status !== 200) return null;
    const body: unknown = await response.json();
    const parsed = GoogleCalendarStatusResponseSchema.safeParse(body);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
