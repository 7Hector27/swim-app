import type { Metadata } from "next";

import CoachContent from "@/content/CoachContent";

export const metadata: Metadata = {
  title: "Coach · JG Swim",
};

export default function CoachPage() {
  return <CoachContent />;
}
