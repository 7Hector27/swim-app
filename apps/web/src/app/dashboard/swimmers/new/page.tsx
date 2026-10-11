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

  const clubs = await fetchClubs(auth.accessToken);

  return <AddSwimmerContent clubs={clubs} />;
}
