import type { Metadata } from "next";
import { redirect } from "next/navigation";

import LoginContent from "@/content/LoginContent";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Sign in · Axiom Aquatics",
};

const NOTICE_MESSAGES: Record<string, string> = {
  "link-expired": "That link expired or was already used.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (data) redirect("/dashboard");

  const params = await searchParams;
  const noticeCode = params.notice ?? "";
  const notice = NOTICE_MESSAGES[noticeCode];

  return <LoginContent {...(notice !== undefined && { notice })} />;
}
