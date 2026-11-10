import type { Metadata } from "next";

import AccountBalanceContent from "@/content/AccountBalanceContent";
import { fetchBalance, fetchBalanceHistory } from "@/lib/api/balance";
import { fetchHousehold } from "@/lib/api/households";
import { requireAuth } from "@/lib/requireAuth";

export const metadata: Metadata = {
  title: "Balance · Axiom Aquatics",
};

interface BalancePageProps {
  searchParams: Promise<{ topup?: string | string[]; resume?: string | string[] }>;
}

export default async function AccountBalancePage({ searchParams }: BalancePageProps) {
  const auth = await requireAuth();
  if (!auth) return null;

  const [balance, historyPage, householdResult] = await Promise.all([
    fetchBalance(auth.accessToken),
    fetchBalanceHistory(auth.accessToken),
    fetchHousehold(auth.accessToken),
  ]);

  const resolvedParams = await searchParams;
  const topupRaw = Array.isArray(resolvedParams.topup)
    ? resolvedParams.topup[0]
    : resolvedParams.topup;
  const topupState: "success" | "cancelled" | null =
    topupRaw === "success" ? "success" : topupRaw === "cancelled" ? "cancelled" : null;

  // ADR 036 Phase 5: when the parent landed here by clicking "Buy a
  // package" on the booking insufficient-balance modal, the URL carries
  // ?resume=book. Subsequent Checkout success_urls point at
  // /dashboard/book?resume=1 so the Stripe round-trip returns the
  // parent to their pending lesson instead of back here.
  const resumeRaw = Array.isArray(resolvedParams.resume)
    ? resolvedParams.resume[0]
    : resolvedParams.resume;
  const resumeBookingReturnTo = resumeRaw === "book" ? "/dashboard/book?resume=1" : null;

  // Default swimmer count for the package highlight + topup form prefill:
  // the household's active swimmer count, clamped to 1..4. Falls back to
  // 1 for brand-new households with no swimmers yet.
  const swimmerCountRaw =
    householdResult.ok && householdResult.household
      ? householdResult.household.swimmerIds.length
      : 1;
  const activeSwimmerCount = Math.max(1, Math.min(4, swimmerCountRaw)) as 1 | 2 | 3 | 4;

  return (
    <AccountBalanceContent
      balance={balance}
      initialHistory={historyPage}
      activeSwimmerCount={activeSwimmerCount}
      topupState={topupState}
      resumeBookingReturnTo={resumeBookingReturnTo}
    />
  );
}
