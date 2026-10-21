import type { Metadata } from "next";

import AccountContent from "@/content/AccountContent";
import { fetchGoogleCalendarStatus } from "@/lib/api/googleCalendar";
import { requireAuth } from "@/lib/requireAuth";

export const metadata: Metadata = {
  title: "Account · Axiom Aquatics",
};

export default async function AccountPage() {
  const auth = await requireAuth();
  if (!auth) return null;
  const googleCalendarStatus =
    auth.profile.role === "coach"
      ? await fetchGoogleCalendarStatus(auth.accessToken)
      : null;
  return (
    <AccountContent profile={auth.profile} googleCalendarStatus={googleCalendarStatus} />
  );
}
