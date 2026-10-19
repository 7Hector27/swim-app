import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { EvaluationDraftSchema } from "@swim-app/shared";
import type { EvaluationDraft } from "@swim-app/shared";

import AccountInactiveScreen from "@/components/AccountInactiveScreen";
import EvaluateContent from "@/content/EvaluateContent";
import { requireAuth } from "@/lib/requireAuth";
import { fetchCoachSwimmerDetail } from "@/lib/api/coachSwimmers";
import { fetchScreens } from "@/lib/api/evaluations";

export const metadata: Metadata = {
  title: "Evaluate · Axiom Aquatics",
};

interface EvaluatePageProps {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string>>;
}

export default async function EvaluatePage({ params, searchParams }: EvaluatePageProps) {
  const [auth, { id }, resolvedSearchParams] = await Promise.all([
    requireAuth(),
    params,
    searchParams ?? Promise.resolve({}),
  ]);
  if (!auth) return <AccountInactiveScreen />;

  const [swimmerResult, screensResult] = await Promise.all([
    fetchCoachSwimmerDetail(id, auth.accessToken),
    fetchScreens(auth.accessToken),
  ]);

  if (!swimmerResult.ok) {
    if (swimmerResult.status === 404) notFound();
    if (swimmerResult.status === 403) redirect("/dashboard");
    throw new Error(`Failed to load swimmer (status ${swimmerResult.status})`);
  }
  if (!screensResult.ok) {
    throw new Error(`Failed to load screens (status ${screensResult.status})`);
  }

  const resolvedParams = resolvedSearchParams as Record<string, string | undefined>;
  const resumeDraftId = resolvedParams["resumeDraft"];
  let resumeDraft: EvaluationDraft | undefined;
  if (resumeDraftId) {
    const draftRes = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/coach/drafts/${resumeDraftId}`, {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
      cache: "no-store",
    });
    if (draftRes.ok) {
      const data: unknown = await draftRes.json().catch(() => null);
      const parsed = EvaluationDraftSchema.safeParse(data);
      if (parsed.success) resumeDraft = parsed.data;
    }
  }

  return (
    <EvaluateContent
      swimmer={swimmerResult.swimmer}
      screens={screensResult.screens}
      {...(resumeDraft !== undefined && { resumeDraft })}
    />
  );
}
