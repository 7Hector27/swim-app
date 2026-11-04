import type { Metadata } from "next";
import { redirect } from "next/navigation";

import AddSwimmerContent from "@/content/AddSwimmerContent";
import { fetchClubs } from "@/lib/api/clubs";
import { requireAuth } from "@/lib/requireAuth";

export const metadata: Metadata = {
  title: "Add a swimmer · Axiom Aquatics",
};

export default async function AddSwimmerPage() {
  const auth = await requireAuth();
  if (!auth) redirect("/login");
  if (auth.profile.role !== "parent") redirect("/dashboard");

  // Write page — the clubs dropdown is required for submission. If we can't
  // load the catalog, surface a route error rather than let the parent pick
  // "none" and lose the chance to tag their swimmer.
  const clubsResult = await fetchClubs(auth.accessToken);
  if (!clubsResult.ok) throw new Error("Failed to load clubs");

  return <AddSwimmerContent clubs={clubsResult.data} />;
}
