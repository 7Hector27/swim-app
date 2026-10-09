import type { Metadata } from "next";

import PrivacyContent from "@/content/PrivacyContent";

export const metadata: Metadata = {
  title: "Privacy Policy · JG Swim",
};

export default function PrivacyPage() {
  return <PrivacyContent />;
}
