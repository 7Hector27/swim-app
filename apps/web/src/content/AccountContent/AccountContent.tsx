import type { GoogleCalendarStatusResponse, MeResponse } from "@swim-app/shared";

import Button from "@/components/Button";
import { capitalizeFirst } from "@/lib/capitalizeFirst";

import EditProfileForm from "./EditProfileForm";
import GoogleCalendarCard from "./GoogleCalendarCard";
import NotificationsSection from "./NotificationsSection";
import { logout } from "./actions";

interface AccountContentProps {
  profile: MeResponse;
  googleCalendarStatus: GoogleCalendarStatusResponse | null;
  // True when the account page was loaded with ?google=error after a failed
  // OAuth callback. Rendered as an inline message above the card actions.
  googleConnectError: boolean;
  // True when the DELETE /coach/calendar call failed (?google=disconnect_error).
  googleDisconnectError: boolean;
  // Threaded down to PushSubscriptionManager so client code never touches
  // @/lib/env. Undefined when not configured (local dev without VAPID keys).
  vapidPublicKey: string | undefined;
}

export default function AccountContent({
  profile,
  googleCalendarStatus,
  googleConnectError,
  googleDisconnectError,
  vapidPublicKey,
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
        {/* Every section is a card with its own heading so the page reads
            as a clear table of contents on phones: Profile → Google
            Calendar → Notifications → Sign out. GoogleCalendarCard and
            NotificationsSection are already cards; Profile wraps the
            read-only Email/Role rows together with EditProfileForm, and
            Sign out gets its own card so the destructive action does not
            dangle below unrelated content. */}
        <div className="mx-auto max-w-sm flex flex-col gap-6">
          <h1 className="text-heading">Account</h1>

          <section
            aria-labelledby="account-profile-heading"
            className="flex flex-col gap-5 rounded-card border border-border p-5"
          >
            <h2
              id="account-profile-heading"
              className="font-heading text-xl text-heading"
            >
              Profile
            </h2>
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
            <div className="border-t border-border" aria-hidden="true" />
            <EditProfileForm
              initialFullName={profile.fullName}
              initialPhone={profile.phone}
            />
          </section>

          {showCalendarCard && (
            <GoogleCalendarCard
              status={googleCalendarStatus}
              connectError={googleConnectError}
              disconnectError={googleDisconnectError}
            />
          )}

          {profile.role === "coach" && (
            <NotificationsSection vapidPublicKey={vapidPublicKey} />
          )}

          <section
            aria-labelledby="account-signout-heading"
            className="flex flex-col gap-4 rounded-card border border-border p-5"
          >
            <h2
              id="account-signout-heading"
              className="font-heading text-xl text-heading"
            >
              Sign out
            </h2>
            <p className="text-sm text-text-secondary">
              You can sign back in anytime.
            </p>
            <form action={logout}>
              <Button type="submit" variant="outline">
                Log out
              </Button>
            </form>
          </section>
        </div>
      </main>
    </div>
  );
}
