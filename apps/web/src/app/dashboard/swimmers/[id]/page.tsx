import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import AccountInactiveScreen from "@/components/AccountInactiveScreen";
import EditSwimmerContent from "@/content/EditSwimmerContent";
import { fetchClubs } from "@/lib/api/clubs";
import { fetchHousehold } from "@/lib/api/households";
import { fetchSwimmer } from "@/lib/api/swimmers";
import { requireAuth } from "@/lib/requireAuth";

export const metadata: Metadata = {
  title: "Edit swimmer · Axiom Aquatics",
};

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EditSwimmerPage({ params }: Props) {
  const [auth, { id }] = await Promise.all([requireAuth(), params]);
  if (!auth) return <AccountInactiveScreen />;

  if (auth.profile.role === "coach") redirect(`/coach/swimmers/${id}`);
  if (auth.profile.role !== "parent") redirect("/dashboard");

  const [swimmerResult, household, clubs] = await Promise.all([
    fetchSwimmer(id, auth.accessToken),
    fetchHousehold(auth.accessToken),
    fetchClubs(auth.accessToken),
  ]);

  if (!swimmerResult.ok) {
    if (swimmerResult.status === 404) notFound();
    if (swimmerResult.status === 403) redirect("/dashboard");
    throw new Error(`Failed to load swimmer (status ${swimmerResult.status})`);
  }

  if (!household) redirect("/dashboard");

  return (
    <EditSwimmerContent
      swimmer={swimmerResult.swimmer}
      householdRole={household.myRole}
      clubs={clubs}
    />
  );
}
