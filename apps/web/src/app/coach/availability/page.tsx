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

  const [seasons, overrides, blockedTimes, preview, config] = await Promise.all([
    fetchSeasons(auth.accessToken),
    fetchOverrides(auth.accessToken),
    fetchBlockedTimes(auth.accessToken),
    fetchAvailabilityPreview(auth.accessToken, weekStart, 7),
    fetchAvailabilityConfig(auth.accessToken),
  ]);

  if (!config) return null;

  return (
    <CoachAvailabilityContent
      initialSeasons={seasons}
      initialOverrides={overrides}
      initialBlockedTimes={blockedTimes}
      initialPreview={preview}
      initialWeekStart={weekStart}
      initialConfig={config}
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
