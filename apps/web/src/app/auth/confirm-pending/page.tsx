import type { Metadata } from "next";
import { redirect } from "next/navigation";

import ConfirmPendingContent from "@/content/ConfirmPendingContent";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Confirm your email · Axiom Aquatics",
};

// Landing page for the audit item 10 flow. A signed-in user whose Supabase
// email_confirmed_at is still null hits any protected route, requireAuth
// sees the API's 403 { error: "email_not_confirmed" }, and redirects here.
// We read the user's email from the Supabase session so the resend action
// can target it; a user with no session shouldn't be here, so we bounce to
// /login.
export default async function ConfirmPendingPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getSession();
  const email = data.session?.user.email;
  if (!email) redirect("/login");

  // Guard against a confirmed user landing here from a stale redirect chain.
  if (data.session?.user.email_confirmed_at) redirect("/dashboard");

  return <ConfirmPendingContent email={email} />;
}
