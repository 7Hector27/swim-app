import type { Metadata } from "next";

import AccountContent from "@/content/AccountContent";
import { requireAuth } from "@/lib/requireAuth";

export const metadata: Metadata = {
  title: "Account · Axiom Aquatics",
};

export default async function AccountPage() {
  const auth = await requireAuth();
  if (!auth) return null;
  return <AccountContent profile={auth.profile} />;
}
