import { todayLA } from "@swim-app/shared";

import { requireAuth } from "@/lib/requireAuth";
import {
  fetchAvailabilityConfig,
  fetchAvailabilityPreview,
  fetchBlockedTimes,
  fetchOverrides,
  fetchSeasons,
} from "@/lib/api/coachAvailability";
import CoachAvailabilityContent from "@/content/CoachAvailabilityContent";

export const metadata = {
  title: "Availability — Axiom Aquatics",
};

export default async function CoachAvailabilityPage() {
  const auth = await requireAuth();
  if (!auth) return null;

  const today = todayLA();
  const weekStart = startOfWeekLA(today);

  const [seasonsResult, overridesResult, blockedTimesResult, previewResult, configResult] =
    await Promise.all([
      fetchSeasons(auth.accessToken),
      fetchOverrides(auth.accessToken),
      fetchBlockedTimes(auth.accessToken),
      fetchAvailabilityPreview(auth.accessToken, weekStart, 7),
      fetchAvailabilityConfig(auth.accessToken),
    ]);

  // Availability is a write page: the coach is here to edit. Every read
  // is primary — if any fails, bounce to the error boundary (coach/error.tsx)
  // rather than render a partial editor.
  if (!seasonsResult.ok) {
    throw new Error(`Failed to load availability (${seasonsResult.reason})`);
  }
  if (!overridesResult.ok) {
    throw new Error(`Failed to load availability (${overridesResult.reason})`);
  }
  if (!blockedTimesResult.ok) {
    throw new Error(`Failed to load availability (${blockedTimesResult.reason})`);
  }
  if (!previewResult.ok) {
    throw new Error(`Failed to load availability (${previewResult.reason})`);
  }
  if (!configResult.ok) {
    throw new Error(`Failed to load availability (${configResult.reason})`);
  }

  return (
    <CoachAvailabilityContent
      initialSeasons={seasonsResult.data}
      initialOverrides={overridesResult.data}
      initialBlockedTimes={blockedTimesResult.data}
      initialPreview={previewResult.data}
      initialWeekStart={weekStart}
      initialConfig={configResult.data}
      today={today}
    />
  );
}

// Monday-based ISO week start, in the LA calendar.
function startOfWeekLA(dateIso: string): string {
  const [year, month, day] = dateIso.split("-").map(Number) as [number, number, number];
  const utc = new Date(Date.UTC(year, month - 1, day));
  const weekday = utc.getUTCDay(); // 0 = Sun, 1 = Mon, …
  const diff = (weekday + 6) % 7; // days since Monday
  utc.setUTCDate(utc.getUTCDate() - diff);
  const yyyy = utc.getUTCFullYear();
  const mm = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(utc.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
