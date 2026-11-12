import type { Metadata } from "next";
import { redirect } from "next/navigation";

import SignupContent from "@/content/SignupContent";
import { createClient } from "@/lib/supabase/server";
import {
  PAYMENTS_REFUND_VERSION,
  PRIVACY_VERSION,
  TERMS_VERSION,
} from "@swim-app/shared";

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
  return (
    <SignupContent
      termsVersion={TERMS_VERSION}
      privacyVersion={PRIVACY_VERSION}
      paymentsRefundVersion={PAYMENTS_REFUND_VERSION}
      {...(params.returnTo !== undefined && { returnTo: params.returnTo })}
    />
  );
}
