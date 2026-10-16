import type { MeResponse } from "@swim-app/shared";

import Button from "@/components/Button";
import SiteFooter from "@/components/SiteFooter";
import { capitalizeFirst } from "@/lib/capitalizeFirst";

import EditProfileForm from "./EditProfileForm";
import { logout } from "./actions";

interface AccountContentProps {
  profile: MeResponse;
}

export default function AccountContent({ profile }: AccountContentProps) {
  return (
    <div className="flex flex-col min-h-screen">
      <main className="flex-1 px-page py-16">
        <div className="mx-auto max-w-sm flex flex-col gap-8">
          <h1 className="text-heading">Account</h1>

          <div className="flex flex-col gap-3">
            <div>
              <p className="text-sm font-semibold text-text-secondary mb-0.5">Email</p>
              <p className="text-text">{capitalizeFirst(profile.email)}</p>
            </div>
            <div>
              <p className="text-sm font-semibold text-text-secondary mb-0.5">Role</p>
              <p className="text-text">{capitalizeFirst(profile.role)}</p>
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
