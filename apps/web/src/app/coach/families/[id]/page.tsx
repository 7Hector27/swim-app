import type { Metadata } from "next";
import { notFound } from "next/navigation";

import CoachFamilyDetailContent from "@/content/CoachFamilyDetailContent";
import {
  fetchCoachFamilies,
  fetchCoachFamilyBalance,
  fetchCoachFamilyBalanceHistory,
  fetchCoachFamilyNeedsManualRefund,
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

  // We pull household name + members + swimmer count from the roster-wide
  // list endpoint rather than adding a per-id metadata endpoint — one
  // round-trip serves both this page and the back-navigation summary.
  const [familiesResult, balanceResult, historyResult, needsManualResult] = await Promise.all([
    fetchCoachFamilies(auth.accessToken),
    fetchCoachFamilyBalance(auth.accessToken, id),
    fetchCoachFamilyBalanceHistory(auth.accessToken, id),
    fetchCoachFamilyNeedsManualRefund(auth.accessToken, id),
  ]);

  if ("kind" in balanceResult && balanceResult.kind === "not_found") notFound();
  if (!("ok" in balanceResult) || !balanceResult.ok) {
    throw new Error(
      `Failed to load family balance (${"reason" in balanceResult ? balanceResult.reason : "unknown"})`,
    );
  }
  if (!familiesResult.ok) {
    throw new Error(`Failed to load families (${familiesResult.reason})`);
  }
  if (!historyResult.ok) {
    throw new Error(`Failed to load family history (${historyResult.reason})`);
  }

  const family = familiesResult.data.find((row) => row.householdId === id);
  if (!family) notFound();

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
            initialBalance={balanceResult.data}
            initialHistory={historyResult.data}
            initialNeedsManualJobs={initialNeedsManualJobs}
          />
        </div>
      </main>
    </div>
  );
}
