import type { Metadata } from "next";

import RefundPolicyContent from "@/content/RefundPolicyContent";

export const metadata: Metadata = {
  title: "Payments, Credit, and Refunds · Axiom Aquatics",
};

export default function RefundPolicyPage() {
  return <RefundPolicyContent />;
}
