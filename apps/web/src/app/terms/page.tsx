import type { Metadata } from "next";

import TermsContent from "@/content/TermsContent";

export const metadata: Metadata = {
  title: "Terms of Service · Axiom Aquatics",
};

export default function TermsPage() {
  return <TermsContent />;
}
