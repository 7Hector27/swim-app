import type { Metadata } from "next";
import { notFound } from "next/navigation";

import CoachFamilyDetailContent from "@/content/CoachFamilyDetailContent";
import {
  fetchCoachFamilyBalance,
  fetchCoachFamilyBalanceHistory,
  fetchCoachFamilyNeedsManualRefund,
  fetchCoachFamilySummary,
  fetchCoachFamilySwimmers,
} from "@/lib/api/coachHouseholds";
import { requireAuth } from "@/lib/requireAuth";

export const metadata: Metadata = {
  title: "Family · Axiom Aquatics",
};

export default async function CoachFamilyDetailPage(props: {
  params: Promise<{ id: string }>;
}) {
  const auth = await requireAuth();
  if (!auth) return null;

  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  // Per-id summary + balance + history + swimmers + needs-manual banner
  // in parallel. The roster list is now paged, so the detail page can't
  // assume a given id lives on page 1 — the summary endpoint serves this
  // lookup directly.
  const [summaryResult, balanceResult, historyResult, swimmersResult, needsManualResult] =
    await Promise.all([
      fetchCoachFamilySummary(auth.accessToken, id),
      fetchCoachFamilyBalance(auth.accessToken, id),
      fetchCoachFamilyBalanceHistory(auth.accessToken, id),
      fetchCoachFamilySwimmers(auth.accessToken, id),
      fetchCoachFamilyNeedsManualRefund(auth.accessToken, id),
    ]);

  if ("kind" in summaryResult && summaryResult.kind === "not_found") notFound();
  if ("kind" in balanceResult && balanceResult.kind === "not_found") notFound();
  if ("kind" in swimmersResult && swimmersResult.kind === "not_found") notFound();
  if (!("ok" in summaryResult) || !summaryResult.ok) {
    throw new Error(
      `Failed to load family summary (${"reason" in summaryResult ? summaryResult.reason : "unknown"})`,
    );
  }
  if (!("ok" in balanceResult) || !balanceResult.ok) {
    throw new Error(
      `Failed to load family balance (${"reason" in balanceResult ? balanceResult.reason : "unknown"})`,
    );
  }
  if (!historyResult.ok) {
    throw new Error(`Failed to load family history (${historyResult.reason})`);
  }

  const family = summaryResult.data;

  // Swimmers card is non-critical to the balance/history above it. A roster
  // outage must not take the whole page down — the card renders its own
  // InlineError with retry instead. "No swimmers yet" is reserved for the
  // confirmed-empty success state.
  const swimmersSection =
    "ok" in swimmersResult && swimmersResult.ok
      ? { ok: true as const, data: swimmersResult.data }
      : { ok: false as const };

  // Needs-manual-handling list is non-critical: if the GET fails the page
  // renders without the banner rather than hard-erroring. The attention
  // list on /coach/families still surfaces the job globally.
  const initialNeedsManualJobs = needsManualResult.ok
    ? needsManualResult.data.jobs
    : [];

  return (
    <div className="flex flex-col flex-1 bg-background">
      <main id="main-content" className="flex-1">
        <div className="mx-auto max-w-content px-page pt-10 pb-tab-safe tablet:pt-14 tablet:pb-24">
          <CoachFamilyDetailContent
            householdId={id}
            householdName={family.householdName}
            memberFullNames={family.memberFullNames}
            activeSwimmerCount={family.activeSwimmerCount}
            swimmers={swimmersSection}
            initialBalance={balanceResult.data}
            initialHistory={historyResult.data}
            initialNeedsManualJobs={initialNeedsManualJobs}
          />
        </div>
      </main>
    </div>
  );
}
