import type { Metadata } from "next";

import ResetPasswordContent from "@/content/ResetPasswordContent";

export const metadata: Metadata = {
  title: "Reset password · Axiom Aquatics",
};

interface Props {
  searchParams: Promise<{ token_hash?: string; type?: string }>;
}

export default async function ResetPasswordPage({ searchParams }: Props) {
  const { token_hash, type } = await searchParams;
  return (
    <ResetPasswordContent
      tokenHash={token_hash ?? null}
      type={type ?? null}
    />
  );
}
