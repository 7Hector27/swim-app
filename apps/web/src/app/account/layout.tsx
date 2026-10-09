import { redirect } from "next/navigation";

import AccountInactiveScreen from "@/components/AccountInactiveScreen";
import { fetchMe } from "@/lib/api/me";
import { createClient } from "@/lib/supabase/server";

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data) redirect("/login");

  const result = await fetchMe();
  if (!result.ok) {
    if (result.status === 403) return <AccountInactiveScreen />;
    redirect("/login");
  }

  return <>{children}</>;
}
