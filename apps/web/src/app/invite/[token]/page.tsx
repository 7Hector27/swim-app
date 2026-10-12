import type { Metadata } from "next";
import { redirect } from "next/navigation";

import InviteContent from "@/content/InviteContent";
import { getInviteStatus } from "@/lib/api/invites";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Join household · Axiom Aquatics",
  // Prevents the token in the URL from leaking to third-party origins via the
  // Referer header.  Sets <meta name="referrer" content="no-referrer">.
  referrer: "no-referrer",
};

interface Props {
  params: Promise<{ token: string }>;
}

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export default async function InvitePage({ params }: Props) {
  const { token } = await params;

  if (!TOKEN_RE.test(token)) {
    return <InviteContent status="not_found" householdName="" token={token} />;
  }

  const inviteData = await getInviteStatus(token);

  if (!inviteData) {
    return <InviteContent status="not_found" householdName="" token={token} />;
  }

  // Redirect unauthenticated users to sign up, but only for pending invites —
  // expired/used/revoked invites show an error to anyone regardless of auth.
  if (inviteData.status === "pending") {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    if (!data) {
      redirect(`/signup?returnTo=/invite/${token}`);
    }
  }

  return (
    <InviteContent
      status={inviteData.status}
      householdName={inviteData.householdName}
      token={token}
    />
  );
}
