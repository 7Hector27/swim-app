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
    household,
    clubs,
    progressResult,
    personalBestsResult,
    scoreHistoryResult,
    upcoming,
    past,
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

  if (!household) redirect("/dashboard");

  return (
    <SwimmerProfileContent
      swimmer={swimmerResult.swimmer}
      householdRole={household.myRole}
      clubs={clubs}
      progress={progressResult.ok ? { ok: true, data: progressResult.data } : { ok: false }}
      scoreHistory={
        scoreHistoryResult.ok ? { ok: true, data: scoreHistoryResult.data } : { ok: false }
      }
      personalBests={
        personalBestsResult.ok ? { ok: true, data: personalBestsResult.data } : { ok: false }
      }
      upcomingLessons={upcoming === null ? { ok: false } : { ok: true, data: upcoming.items }}
      pastLessons={past === null ? { ok: false } : { ok: true, data: past }}
    />
  );
}
