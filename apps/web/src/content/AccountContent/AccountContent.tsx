import { redirect } from "next/navigation";

import Button from "@/components/Button";
import SiteFooter from "@/components/SiteFooter";
import SiteNav from "@/components/SiteNav";
import { createClient } from "@/lib/supabase/server";

import { logout } from "./actions";

export default async function AccountContent() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data) redirect("/login");

  const email = data.claims["email"] as string;

  return (
    <div className="flex flex-col min-h-screen">
      <SiteNav />
      <main className="flex-1 flex items-center justify-center px-page py-16">
        <div className="w-full max-w-sm flex flex-col gap-6">
          <h1 className="text-heading">Account</h1>
          <div>
            <p className="text-sm font-semibold text-text-secondary mb-1">Signed in as</p>
            <p className="text-text font-semibold">{email}</p>
          </div>
          <form action={logout}>
            <Button type="submit" variant="outline">
              Log out
            </Button>
          </form>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
