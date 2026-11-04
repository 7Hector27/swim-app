import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import AccountInactiveScreen from "@/components/AccountInactiveScreen";
import CoachBatchDetailContent from "@/content/CoachBatchDetailContent";
import { requireAuth } from "@/lib/requireAuth";
import { fetchCoachBatch } from "@/lib/api/lessons";

export const metadata: Metadata = {
  title: "Booking · Axiom Aquatics",
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function CoachBatchPage({ params }: PageProps) {
  const [auth, { id }] = await Promise.all([requireAuth(), params]);
  if (!auth) return <AccountInactiveScreen />;
  if (auth.profile.role !== "coach") redirect("/dashboard");

  const batchResult = await fetchCoachBatch(auth.accessToken, id);
  if (!batchResult.ok) {
    if (batchResult.status === 404) notFound();
    throw new Error(`Failed to load batch (status ${batchResult.status})`);
  }

  return <CoachBatchDetailContent batch={batchResult.batch} />;
}
