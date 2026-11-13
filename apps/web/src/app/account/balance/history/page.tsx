import type { Metadata } from "next";

import BalanceHistoryContent from "@/content/BalanceHistoryContent";
import { fetchBalanceHistory } from "@/lib/api/balance";
import { requireAuth } from "@/lib/requireAuth";

export const metadata: Metadata = {
  title: "Transaction history · Axiom Aquatics",
};

export default async function AccountBalanceHistoryPage() {
  const auth = await requireAuth();
  if (!auth) return null;

  const historyPage = await fetchBalanceHistory(auth.accessToken);
  return <BalanceHistoryContent initial={historyPage} />;
}
