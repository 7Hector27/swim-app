import type { Metadata } from "next";
import { notFound } from "next/navigation";

import AccountInactiveScreen from "@/components/AccountInactiveScreen";
import CoachMeetDetailContent from "@/content/CoachMeetDetailContent";
import { requireAuth } from "@/lib/requireAuth";
import { fetchMeetDetail } from "@/lib/api/meets";
import { fetchCoachSwimmers } from "@/lib/api/coachSwimmers";

export const metadata: Metadata = {
  title: "Meet · Axiom Aquatics",
};

interface CoachMeetPageProps {
  params: Promise<{ id: string }>;
}

export default async function CoachMeetPage({ params }: CoachMeetPageProps) {
  const [auth, { id }] = await Promise.all([requireAuth(), params]);
  if (!auth) return <AccountInactiveScreen />;

  const [meetResult, swimmersResult] = await Promise.all([
    fetchMeetDetail(id, auth.accessToken),
    fetchCoachSwimmers(auth.accessToken),
  ]);

  if (!meetResult.ok) {
    if (meetResult.status === 404) notFound();
    throw new Error(`Failed to load meet (status ${meetResult.status})`);
  }

  // Write surface — the meet page includes an Add swim form whose swimmer
  // dropdown comes from this fetch. Treat the whole page as primary so we
  // never render the form without the dropdown's options.
  if (!swimmersResult.ok) {
    throw new Error(`Failed to load swimmers (${swimmersResult.reason})`);
  }

  return <CoachMeetDetailContent meet={meetResult.meet} swimmers={swimmersResult.data} />;
}
