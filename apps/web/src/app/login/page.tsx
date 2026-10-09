import type { Metadata } from "next";
import { redirect } from "next/navigation";

import LoginContent from "@/content/LoginContent";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Sign in · JG Swim",
};

export default async function LoginPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (data) redirect("/account");

  return <LoginContent />;
}
