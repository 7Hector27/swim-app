import type { Metadata } from "next";
import { redirect } from "next/navigation";

import ForgotPasswordContent from "@/content/ForgotPasswordContent";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Forgot password · Axiom Aquatics",
};

export default async function ForgotPasswordPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (data) redirect("/dashboard");
  return <ForgotPasswordContent />;
}
