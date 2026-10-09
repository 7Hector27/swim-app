import type { Metadata } from "next";
import { redirect } from "next/navigation";

import SignupContent from "@/content/SignupContent";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Create account · JG Swim",
};

export default async function SignupPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (data) redirect("/dashboard");

  return <SignupContent />;
}
