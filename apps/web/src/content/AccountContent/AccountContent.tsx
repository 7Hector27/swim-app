import type { GoogleCalendarStatusResponse, MeResponse } from "@swim-app/shared";

import Button from "@/components/Button";
import { capitalizeFirst } from "@/lib/capitalizeFirst";

import EditProfileForm from "./EditProfileForm";
import GoogleCalendarCard from "./GoogleCalendarCard";
import { logout } from "./actions";

interface AccountContentProps {
  profile: MeResponse;
  googleCalendarStatus: GoogleCalendarStatusResponse | null;
  // True when the account page was loaded with ?google=error after a failed
  // OAuth callback. Rendered as an inline message above the card actions.
  googleConnectError: boolean;
  // True when the DELETE /coach/calendar call failed (?google=disconnect_error).
  googleDisconnectError: boolean;
}

export default function AccountContent({
  profile,
  googleCalendarStatus,
  googleConnectError,
  googleDisconnectError,
}: AccountContentProps) {
  // Hide the card entirely when the API hasn't been configured for Google
  // (dev without env vars, or an API deploy that doesn't support it) and
  // for parents — only coaches get the integration.
  const showCalendarCard =
    profile.role === "coach" &&
    googleCalendarStatus !== null &&
    googleCalendarStatus.status !== "not_configured";

  return (
    <div className="flex flex-col flex-1">
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

          {showCalendarCard && (
            <GoogleCalendarCard
              status={googleCalendarStatus}
              connectError={googleConnectError}
              disconnectError={googleDisconnectError}
            />
          )}

          <form action={logout}>
            <Button type="submit" variant="outline">
              Log out
            </Button>
          </form>
        </div>
      </main>
    </div>
  );
}
