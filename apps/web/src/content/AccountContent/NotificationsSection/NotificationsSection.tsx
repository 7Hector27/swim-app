import PreferencesForm from "./PreferencesForm";
import PushSubscriptionManager from "./PushSubscriptionManager";

interface Props {
  // VAPID key is passed in from the server page (apps/web/src/app/account/
  // page.tsx), which is the only layer allowed to touch @/lib/env. Server-
  // only env lookups cannot cross the client boundary; everything the
  // browser needs rides in as a plain prop.
  vapidPublicKey: string | undefined;
}

// Server component wrapper — all state lives in the client children. The
// section renders only for coaches (gated by AccountContent).
export default function NotificationsSection({ vapidPublicKey }: Props) {
  return (
    <section
      aria-labelledby="notifications-section-heading"
      className="flex flex-col gap-5 rounded-card border border-border p-5"
    >
      <h2
        id="notifications-section-heading"
        className="font-heading text-xl text-heading"
      >
        Notifications
      </h2>
      <PushSubscriptionManager vapidPublicKey={vapidPublicKey} />
      <div className="border-t border-border" aria-hidden="true" />
      <PreferencesForm />
    </section>
  );
}
