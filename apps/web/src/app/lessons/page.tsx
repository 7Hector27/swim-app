import type { Metadata } from "next";

import LessonsContent from "@/content/LessonsContent";

export const metadata: Metadata = {
  title: "Lessons · Axiom Aquatics",
};

export default function LessonsPage() {
  return <LessonsContent />;
}
