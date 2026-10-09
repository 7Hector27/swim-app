import { redirect } from "next/navigation";

import Button from "@/components/Button";
import SiteFooter from "@/components/SiteFooter";
import SiteNav from "@/components/SiteNav";
import { fetchMe } from "@/lib/api/me";
import { createClient } from "@/lib/supabase/server";

import EditProfileForm from "./EditProfileForm";
import { logout } from "./actions";

export default async function AccountContent() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data) redirect("/login");

  const email = data.claims["email"] as string;

  const result = await fetchMe();
  if (!result.ok) redirect("/login");

  const { profile } = result;

  return (
    <div className="flex flex-col min-h-screen">
      <SiteNav />
      <main className="flex-1 px-page py-16">
        <div className="mx-auto max-w-sm flex flex-col gap-8">
          <h1 className="text-heading">Account</h1>

          <div className="flex flex-col gap-3">
            <div>
              <p className="text-sm font-semibold text-text-secondary mb-0.5">Email</p>
              <p className="text-text">{email}</p>
            </div>
            <div>
              <p className="text-sm font-semibold text-text-secondary mb-0.5">Role</p>
              <p className="text-text">{profile.role}</p>
            </div>
          </div>

          <EditProfileForm
            initialFullName={profile.fullName}
            initialPhone={profile.phone}
          />

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
