"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { CoachPushSubscriptionListItem } from "@swim-app/shared";

import {
  deletePushSubscription,
  fetchPushSubscriptions,
  registerPushSubscription,
  sendTestPush,
} from "@/lib/api/coachAlerts";

import {
  describeUserAgent,
  detectSupport,
  getPermission,
  urlBase64ToUint8Array,
  type SupportState,
} from "./pushEnvironment";

const APP_KEY_CACHE = "coach-alerts-config-v1";
const APP_KEY_URL = "/__sw-config/vapid-public-key";

interface Props {
  // VAPID public key, passed down from the server page. Client components
  // never import @/lib/env (see CLAUDE.md) — the server page reads it from
  // process.env and hands it over as a plain string so the client bundle
  // doesn't try to iterate process.env at runtime.
  vapidPublicKey: string | undefined;
  // Rendered when the browser lacks support — "Open in Chrome, Edge, …"
  // The two states are visually similar but copy differs.
  initialSupport?: SupportState;
}

type EnableStatus = "idle" | "requesting" | "subscribing" | "error";
type TestStatus = "idle" | "sending" | "sent" | "error";

export default function PushSubscriptionManager({ vapidPublicKey, initialSupport }: Props) {
  const [support, setSupport] = useState<SupportState>(initialSupport ?? "ready");
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const [subscriptions, setSubscriptions] = useState<CoachPushSubscriptionListItem[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [enableStatus, setEnableStatus] = useState<EnableStatus>("idle");
  const [enableError, setEnableError] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<TestStatus>("idle");
  const [testError, setTestError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const didInit = useRef(false);
  // The "Sent" badge after a successful test clears after 2.5s. Track
  // the timer in a ref and clear it on unmount so a late tick cannot
  // call setTestStatus against a dead component.
  const testTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (testTimeoutRef.current !== null) {
        clearTimeout(testTimeoutRef.current);
      }
    };
  }, []);

  const refreshSubscriptions = useCallback(async () => {
    const result = await fetchPushSubscriptions();
    if (result.ok) {
      setSubscriptions(result.data.items);
    }
    setLoadingList(false);
  }, []);

  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    setSupport(detectSupport());
    setPermission(getPermission());
    void refreshSubscriptions();
  }, [refreshSubscriptions]);

  async function cacheVapidKey(): Promise<void> {
    // Stash the VAPID public key into a Cache so the service worker's
    // `pushsubscriptionchange` handler can re-subscribe without a round-
    // trip to the server. Cheap and idempotent.
    if (!vapidPublicKey) return;
    try {
      const cache = await caches.open(APP_KEY_CACHE);
      await cache.put(APP_KEY_URL, new Response(vapidPublicKey));
    } catch {
      // Non-fatal — pushsubscriptionchange just won't auto-recover.
    }
  }

  async function handleEnable() {
    setEnableError(null);
    if (!vapidPublicKey) {
      setEnableStatus("error");
      setEnableError("Push is not configured on this environment.");
      return;
    }
    setEnableStatus("requesting");
    let perm: NotificationPermission;
    try {
      perm = await Notification.requestPermission();
    } catch {
      setEnableStatus("error");
      setEnableError("Could not request permission. Try again.");
      return;
    }
    setPermission(perm);
    if (perm !== "granted") {
      setEnableStatus("idle");
      return;
    }
    setEnableStatus("subscribing");
    try {
      // Register the service worker (idempotent — the browser dedupes on
      // scriptURL + scope). Then subscribe.
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);
      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ?? (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          // Lib DOM types for applicationServerKey are narrower than
          // what the browser accepts. Uint8Array is a valid BufferSource.
          applicationServerKey: applicationServerKey as unknown as BufferSource,
        }));
      await cacheVapidKey();
      const result = await registerPushSubscription(subscription.toJSON());
      if (!result.ok) {
        setEnableStatus("error");
        setEnableError("Could not register this device. Try again.");
        return;
      }
      setEnableStatus("idle");
      await refreshSubscriptions();
    } catch {
      setEnableStatus("error");
      setEnableError("Could not enable notifications on this device.");
    }
  }

  async function handleRemove(id: string) {
    setRemovingId(id);
    const result = await deletePushSubscription(id);
    setRemovingId(null);
    if (result.ok) {
      // Also tear down the browser-side subscription when the current
      // device is the one being removed. The server already marked the
      // row inactive; this just stops future pushes to this browser.
      try {
        const registration = await navigator.serviceWorker.getRegistration("/");
        const sub = await registration?.pushManager.getSubscription();
        if (sub) await sub.unsubscribe();
      } catch {
        // Non-fatal.
      }
      await refreshSubscriptions();
    }
  }

  async function handleTest() {
    setTestError(null);
    setTestStatus("sending");
    const result = await sendTestPush();
    if (result.ok) {
      // Partial failure (some subs delivered, others didn't) still counts
      // as sent — but surface the first failure so the coach can see what
      // happened on the devices that didn't get through. Zero deliveries
      // with errors flips to the error branch and shows the first reason.
      if (result.data.deliveredCount === 0 && result.data.errors.length > 0) {
        setTestStatus("error");
        setTestError(result.data.errors[0]!.reason);
        return;
      }
      setTestStatus("sent");
      if (result.data.errors.length > 0) setTestError(result.data.errors[0]!.reason);
      if (testTimeoutRef.current !== null) clearTimeout(testTimeoutRef.current);
      testTimeoutRef.current = setTimeout(() => {
        testTimeoutRef.current = null;
        setTestStatus((state) => (state === "sent" ? "idle" : state));
      }, 2500);
      return;
    }
    setTestStatus("error");
    setTestError(result.reason);
  }

  // ── Render branches ───────────────────────────────────────────────────────

  if (support === "unsupported") {
    return (
      <StatusMessage>
        This browser does not support notifications. Open the app in Chrome, Edge, or Firefox, or on
        iPhone add it to your home screen and reopen from the icon.
      </StatusMessage>
    );
  }

  if (support === "ios-not-installed") {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-text">
          To enable notifications on iPhone, add this app to your home screen first.
        </p>
        <ol className="text-sm text-text-secondary flex flex-col gap-1 pl-5 list-decimal">
          <li>Tap the Share icon at the bottom of Safari.</li>
          <li>Choose &ldquo;Add to Home Screen&rdquo;.</li>
          <li>Open the app from the new home-screen icon, then return here.</li>
        </ol>
      </div>
    );
  }

  if (permission === "denied") {
    return (
      <StatusMessage tone="warn">
        Notifications are blocked for this site. Open the browser&rsquo;s site settings to allow
        them, then return here.
      </StatusMessage>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {permission !== "granted" && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-text-secondary">
            Get a lock-screen alert the moment a parent books or changes a lesson.
          </p>
          <button
            type="button"
            onClick={handleEnable}
            disabled={enableStatus === "requesting" || enableStatus === "subscribing"}
            className="inline-flex items-center justify-center rounded-button bg-button-primary-background text-button-primary-text font-bold text-sm min-h-[44px] px-5 transition-opacity duration-150 hover:opacity-90 active:scale-[0.97] disabled:opacity-60"
          >
            {enableStatus === "requesting"
              ? "Waiting for permission…"
              : enableStatus === "subscribing"
                ? "Registering…"
                : "Turn on notifications"}
          </button>
          {enableError && (
            <p role="alert" className="text-sm text-danger">
              {enableError}
            </p>
          )}
        </div>
      )}

      {permission === "granted" && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-text">Devices</h3>
            <button
              type="button"
              onClick={handleTest}
              disabled={testStatus === "sending" || subscriptions.length === 0}
              className="text-xs font-semibold text-accent hover:underline disabled:opacity-60 disabled:no-underline active:scale-[0.97] transition-transform duration-150"
            >
              {testStatus === "sending"
                ? "Sending…"
                : testStatus === "sent"
                  ? "Sent"
                  : testStatus === "error"
                    ? "Could not send"
                    : "Send test notification"}
            </button>
          </div>
          {testStatus === "error" && testError && (
            <p role="alert" className="text-xs text-danger">
              {testError}
            </p>
          )}

          {loadingList ? (
            <p className="text-sm text-text-secondary">Loading devices…</p>
          ) : subscriptions.length === 0 ? (
            <p className="text-sm text-text-secondary">
              Notifications are off on this account. Tap &ldquo;Turn on notifications&rdquo; above
              to enable this device.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {subscriptions.map((subscription) => (
                <li
                  key={subscription.id}
                  className="flex items-center justify-between gap-3 rounded-card border border-border px-4 py-3"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-semibold text-text">
                      {describeUserAgent(subscription.userAgent)}
                    </span>
                    <span className="text-xs text-text-secondary">
                      Added {formatDate(subscription.createdAt)}
                      {subscription.lastDeliveryAt
                        ? ` · last used ${formatDate(subscription.lastDeliveryAt)}`
                        : ""}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemove(subscription.id)}
                    disabled={removingId === subscription.id}
                    className="text-xs font-semibold text-danger hover:underline disabled:opacity-60 active:scale-[0.97] transition-transform duration-150"
                  >
                    {removingId === subscription.id ? "Removing…" : "Remove"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function StatusMessage({
  children,
  tone = "info",
}: {
  children: React.ReactNode;
  tone?: "info" | "warn";
}) {
  return (
    <p
      role={tone === "warn" ? "alert" : undefined}
      className={`text-sm ${tone === "warn" ? "text-danger" : "text-text-secondary"}`}
    >
      {children}
    </p>
  );
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Los_Angeles",
  });
}
