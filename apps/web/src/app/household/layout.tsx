import AccountInactiveScreen from "@/components/AccountInactiveScreen";
import { requireAuth } from "@/lib/requireAuth";

export default async function HouseholdLayout({ children }: { children: React.ReactNode }) {
  const auth = await requireAuth();
  if (auth === null) return <AccountInactiveScreen />;
  return <>{children}</>;
}
