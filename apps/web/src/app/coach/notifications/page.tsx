import type { Metadata } from "next";

import CoachNotificationsContent from "@/content/CoachNotificationsContent";

export const metadata: Metadata = {
  title: "Notifications · Axiom Aquatics",
};

export default function CoachNotificationsPage() {
  // Auth is guaranteed by apps/web/src/app/coach/layout.tsx. The content
  // component fetches the list client-side (same client as the dropdown)
  // so the two surfaces share state and the "mark all read" button is
  // reactive without a hard reload.
  return <CoachNotificationsContent />;
}
