import type { Metadata } from "next";

import TermsContent from "@/content/TermsContent";

export const metadata: Metadata = {
  title: "Terms of Service · JG Swim",
};

export default function TermsPage() {
  return <TermsContent />;
}
