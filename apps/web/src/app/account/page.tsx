import type { Metadata } from "next";

import AccountContent from "@/content/AccountContent";
import { fetchDeletionPreview } from "@/lib/api/accountDeletion";
import { fetchGoogleCalendarStatus } from "@/lib/api/googleCalendar";
import { publicEnv } from "@/lib/env";
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
  // Deletion preview is pre-fetched on the server so the section can
  // render per-case copy without a client round-trip when the user
  // opens it. Parent-only (ADR 034) — the coach account isn't managed
  // through this flow in v1.
  const deletionPreview =
    auth.profile.role === "parent"
      ? await fetchDeletionPreview(auth.accessToken)
      : null;
  const resolvedParams = await searchParams;
  const googleParam = Array.isArray(resolvedParams.google) ? resolvedParams.google[0] : resolvedParams.google;
  const googleConnectError = googleParam === "error";
  const googleDisconnectError = googleParam === "disconnect_error";
  return (
    <AccountContent
      profile={auth.profile}
      googleCalendarStatus={googleCalendarStatus}
      googleConnectError={googleConnectError}
      googleDisconnectError={googleDisconnectError}
      vapidPublicKey={publicEnv.vapidPublicKey}
      deletionPreview={deletionPreview}
    />
  );
}
