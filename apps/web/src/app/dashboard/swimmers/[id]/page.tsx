import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import AccountInactiveScreen from "@/components/AccountInactiveScreen";
import SwimmerProfileContent from "@/content/SwimmerProfileContent";
import { fetchClubs } from "@/lib/api/clubs";
import { fetchHousehold } from "@/lib/api/households";
import { fetchUpcomingLessons, fetchPastLessonsResult } from "@/lib/api/lessons";
import {
  fetchParentPersonalBests,
  fetchParentScoreHistory,
  fetchParentSwimmerProgress,
} from "@/lib/api/parentProgress";
import { fetchSwimmer } from "@/lib/api/swimmers";
import type { SectionResult } from "@/content/SwimmerProfileContent/SwimmerProfileContent";
import type { Club } from "@swim-app/shared";
import { requireAuth } from "@/lib/requireAuth";

export const metadata: Metadata = {
  title: "Swimmer profile · Axiom Aquatics",
};

interface Props {
  params: Promise<{ id: string }>;
}

export default async function SwimmerProfilePage({ params }: Props) {
  const [auth, { id }] = await Promise.all([requireAuth(), params]);
  if (!auth) return <AccountInactiveScreen />;

  if (auth.profile.role === "coach") redirect(`/coach/swimmers/${id}`);
  if (auth.profile.role !== "parent") redirect("/dashboard");

  const token = auth.accessToken;

  const [
    swimmerResult,
    householdResult,
    clubsResult,
    progressResult,
    personalBestsResult,
    scoreHistoryResult,
    upcomingResult,
    pastResult,
  ] = await Promise.all([
    fetchSwimmer(id, token),
    fetchHousehold(token),
    fetchClubs(token),
    fetchParentSwimmerProgress(id, token),
    fetchParentPersonalBests(id, token),
    fetchParentScoreHistory(id, token),
    fetchUpcomingLessons(token),
    fetchPastLessonsResult(token),
  ]);

  if (!swimmerResult.ok) {
    if (swimmerResult.status === 404) notFound();
    if (swimmerResult.status === 403) redirect("/dashboard");
    throw new Error(`Failed to load swimmer (status ${swimmerResult.status})`);
  }

  // Household role gates the Edit/Book buttons. Throw on load failure so
  // the error boundary renders — never redirect to /dashboard (which would
  // mask a server error as a "not enrolled" state).
  if (!householdResult.ok) {
    throw new Error(`Failed to load household (status ${householdResult.status})`);
  }
  if (householdResult.household === null) redirect("/dashboard");

  // Clubs power the display-only club name on the profile. Thread the
  // SectionResult down so the content can show "Couldn't load club" in
  // place of a blank name instead of silently falling back to [].
  const clubsSection: SectionResult<Club[]> = clubsResult.ok
    ? { ok: true, data: clubsResult.data }
    : { ok: false };

  return (
    <SwimmerProfileContent
      swimmer={swimmerResult.swimmer}
      householdRole={householdResult.household.myRole}
      clubsResult={clubsSection}
      progress={progressResult.ok ? { ok: true, data: progressResult.data } : { ok: false }}
      scoreHistory={
        scoreHistoryResult.ok ? { ok: true, data: scoreHistoryResult.data } : { ok: false }
      }
      personalBests={
        personalBestsResult.ok ? { ok: true, data: personalBestsResult.data } : { ok: false }
      }
      upcomingLessons={upcomingResult.ok ? { ok: true, data: upcomingResult.data.items } : { ok: false }}
      pastLessons={pastResult.ok ? { ok: true, data: pastResult.data } : { ok: false }}
    />
  );
}
