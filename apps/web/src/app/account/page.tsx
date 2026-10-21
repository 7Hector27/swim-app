import type { Metadata } from "next";

import AccountContent from "@/content/AccountContent";
import { fetchGoogleCalendarStatus } from "@/lib/api/googleCalendar";
import { requireAuth } from "@/lib/requireAuth";

export const metadata: Metadata = {
  title: "Account · Axiom Aquatics",
};

interface AccountPageProps {
  searchParams: Promise<{ google?: string | string[] }>;
}

export default async function AccountPage({ searchParams }: AccountPageProps) {
  const auth = await requireAuth();
  if (!auth) return null;
  const googleCalendarStatus =
    auth.profile.role === "coach"
      ? await fetchGoogleCalendarStatus(auth.accessToken)
      : null;
  const resolvedParams = await searchParams;
  const googleParam = Array.isArray(resolvedParams.google) ? resolvedParams.google[0] : resolvedParams.google;
  const googleConnectError = googleParam === "error";
  return (
    <AccountContent
      profile={auth.profile}
      googleCalendarStatus={googleCalendarStatus}
      googleConnectError={googleConnectError}
    />
  );
}
