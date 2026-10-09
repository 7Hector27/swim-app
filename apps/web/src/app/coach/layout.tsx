import { redirect } from "next/navigation";

import AccountInactiveScreen from "@/components/AccountInactiveScreen";
import { requireAuth } from "@/lib/requireAuth";

export default async function CoachLayout({ children }: { children: React.ReactNode }) {
  const auth = await requireAuth();
  if (auth === null) return <AccountInactiveScreen />;
  if (auth.profile.role !== "coach") redirect("/dashboard");
  return <>{children}</>;
}
