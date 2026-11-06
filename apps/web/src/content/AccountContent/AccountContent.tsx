import type {
  DeletionPreviewResponse,
  GoogleCalendarStatusResponse,
  MeResponse,
} from "@swim-app/shared";

import Button from "@/components/Button";
import { capitalizeFirst } from "@/lib/capitalizeFirst";

import AccountSectionNav from "./AccountSectionNav";
import DeleteAccountSection from "./DeleteAccountSection";
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
  // ADR 034 Phase 4. Server-side pre-fetch so the Delete account section
  // can render its per-case copy without a client round-trip. Null for
  // coaches (not supported in v1) and when the preview endpoint failed.
  deletionPreview: DeletionPreviewResponse | null;
}

export default function AccountContent({
  profile,
  googleCalendarStatus,
  googleConnectError,
  googleDisconnectError,
  vapidPublicKey,
  deletionPreview,
}: AccountContentProps) {
  // Hide the Calendar section entirely when the API hasn't been configured
  // for Google (dev without env vars, or an API deploy that doesn't support
  // it) and for parents — only coaches get the integration.
  const showCalendarCard =
    profile.role === "coach" &&
    googleCalendarStatus !== null &&
    googleCalendarStatus.status !== "not_configured";

  const showNotifications = profile.role === "coach";
  // Parent-only (ADR 034). Coaches don't self-delete through this flow
  // in v1. The preview being null is treated as "section unavailable" —
  // the component renders a short apology but the nav entry stays so
  // the user can still find it.
  const showDeleteAccount = profile.role === "parent";

  // Only list sections the role actually sees — no placeholder entries for
  // features the current role can't touch.
  const navItems: Array<{ id: string; label: string }> = [
    { id: "profile", label: "Profile" },
  ];
  if (showCalendarCard) navItems.push({ id: "calendar", label: "Calendar" });
  if (showNotifications) navItems.push({ id: "notifications", label: "Notifications" });
  navItems.push({ id: "security", label: "Security" });
  if (showDeleteAccount) navItems.push({ id: "delete-account", label: "Delete account" });

  return (
    <div className="flex flex-col flex-1">
      <main id="main-content" className="flex-1 px-page py-16">
        <div className="mx-auto max-w-content flex flex-col gap-6 desktop:gap-10">
          <h1 className="text-heading">Account</h1>

          <div className="flex flex-col gap-6 desktop:flex-row desktop:items-start desktop:gap-10">
            <AccountSectionNav items={navItems} />

            <div className="flex flex-col gap-6 flex-1 min-w-0 desktop:max-w-[640px]">
              <section
                id="profile"
                aria-labelledby="account-profile-heading"
                className="flex flex-col gap-5 rounded-card border border-border p-5 scroll-mt-[calc(var(--header-height)+1rem)]"
              >
                <h2
                  id="account-profile-heading"
                  className="font-heading text-xl text-heading"
                  style={{ fontVariationSettings: '"SOFT" 100, "WONK" 0' }}
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
                <div id="calendar" className="scroll-mt-[calc(var(--header-height)+1rem)]">
                  <GoogleCalendarCard
                    status={googleCalendarStatus}
                    connectError={googleConnectError}
                    disconnectError={googleDisconnectError}
                  />
                </div>
              )}

              {showNotifications && (
                <div id="notifications" className="scroll-mt-[calc(var(--header-height)+1rem)]">
                  <NotificationsSection vapidPublicKey={vapidPublicKey} />
                </div>
              )}

              <section
                id="security"
                aria-labelledby="account-security-heading"
                className="flex flex-col gap-4 rounded-card border border-border p-5 scroll-mt-[calc(var(--header-height)+1rem)]"
              >
                <h2
                  id="account-security-heading"
                  className="font-heading text-xl text-heading"
                  style={{ fontVariationSettings: '"SOFT" 100, "WONK" 0' }}
                >
                  Security
                </h2>
                <p className="text-sm text-text-secondary">
                  Sign out of this device. You can sign back in anytime.
                </p>
                <form action={logout}>
                  <Button type="submit" variant="outline">
                    Log out
                  </Button>
                </form>
              </section>

              {showDeleteAccount && (
                <div
                  id="delete-account"
                  className="scroll-mt-[calc(var(--header-height)+1rem)]"
                >
                  <DeleteAccountSection preview={deletionPreview} />
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
