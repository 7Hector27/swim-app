import type { Metadata } from "next";
import { notFound } from "next/navigation";

import AccountInactiveScreen from "@/components/AccountInactiveScreen";
import CoachMeetDetailContent from "@/content/CoachMeetDetailContent";
import { requireAuth } from "@/lib/requireAuth";
import { fetchMeetDetail, fetchAllSwimmerBests } from "@/lib/api/meets";
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

  const [meetResult, swimmersResult, bestsResult] = await Promise.all([
    fetchMeetDetail(id, auth.accessToken),
    fetchCoachSwimmers(auth.accessToken),
    fetchAllSwimmerBests(auth.accessToken),
  ]);

  if (!meetResult.ok) {
    if (meetResult.status === 404) notFound();
    throw new Error(`Failed to load meet (status ${meetResult.status})`);
  }

  // Write surface — the meet page includes the entry form whose swimmer
  // picker comes from this fetch. Treat the whole page as primary so we
  // never render the form without the picker's options.
  if (!swimmersResult.ok) {
    throw new Error(`Failed to load swimmers (${swimmersResult.reason})`);
  }

  // PBs are advisory: fall back to no feedback rather than failing the page.
  const bestsRows = bestsResult.ok ? bestsResult.data.rows : [];

  return (
    <CoachMeetDetailContent
      meet={meetResult.meet}
      swimmers={swimmersResult.data}
      swimmerBests={bestsRows}
    />
  );
}
