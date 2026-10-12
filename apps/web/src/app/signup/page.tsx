import type { Metadata } from "next";
import { redirect } from "next/navigation";

import SignupContent from "@/content/SignupContent";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Create account · Axiom Aquatics",
};

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (data) redirect("/dashboard");

  const params = await searchParams;
  return <SignupContent {...(params.returnTo !== undefined && { returnTo: params.returnTo })} />;
}
