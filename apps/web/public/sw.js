// Coach alerts service worker — ADR 031 phase 2.
//
// Three listeners, no fetch handler, no cache. V1 is push-only; adding
// background sync or offline caching later means adding a `fetch` listener
// and a cache-naming scheme, neither of which exists yet.
//
// Shipped as a static file at /sw.js so Next.js doesn't bundle it. Keep it
// plain ES2017: no imports, no TypeScript, no await on top-level.

// ── push ─────────────────────────────────────────────────────────────────────
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    // Non-JSON pushes (service worker test probes, dev tools) — ignore.
    return;
  }
  const title = typeof payload.title === "string" ? payload.title : "Axiom Aquatics";
  const body = typeof payload.body === "string" ? payload.body : "";
  const tag = typeof payload.tag === "string" ? payload.tag : undefined;
  const clickUrl = typeof payload.click_url === "string" ? payload.click_url : "/";
  const urgency = payload.urgency === "urgent";

  const options = {
    body,
    icon: "/icons/android-chrome-192x192.png",
    badge: "/icons/favicon-32x32.png",
    data: { click_url: clickUrl },
    // Urgent lock-screen stickiness: on desktop the toast stays until the
    // coach dismisses it; on mobile this is advisory.
    requireInteraction: urgency,
  };
  if (tag) options.tag = tag;

  event.waitUntil(self.registration.showNotification(title, options));
});

// ── notificationclick ────────────────────────────────────────────────────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const clickUrl = typeof data.click_url === "string" && data.click_url ? data.click_url : "/";

  event.waitUntil((async () => {
    const absolute = toAbsoluteUrl(clickUrl);
    const clientsList = await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    });

    // Prefer the exact match on href; fall back to any same-origin window
    // and navigate it. This matches the "focus if open" rule in the plan
    // — a coach with the app already open doesn't get a second tab.
    for (const client of clientsList) {
      if (client.url === absolute && "focus" in client) {
        return client.focus();
      }
    }
    for (const client of clientsList) {
      if (new URL(client.url).origin === self.location.origin && "navigate" in client) {
        try {
          await client.navigate(absolute);
          return client.focus();
        } catch {
          // Some browsers (Firefox) throw on cross-document navigate — fall
          // through to opening a new window.
        }
      }
    }
    if (self.clients.openWindow) {
      return self.clients.openWindow(absolute);
    }
    return undefined;
  })());
});

// ── pushsubscriptionchange ───────────────────────────────────────────────────
// The browser rotates the push endpoint (e.g., FCM renew). Re-subscribe
// with the cached VAPID key and POST the fresh subscription back to the
// API so the row is current.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil((async () => {
    const key = await loadApplicationServerKey();
    if (!key) return;
    try {
      const subscription = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key,
      });
      await postSubscription(subscription);
    } catch {
      // Nothing we can do from here — the next time the coach opens the
      // app, PushSubscriptionManager will detect the missing subscription
      // and re-register.
    }
  })());
});

// ── helpers ──────────────────────────────────────────────────────────────────

function toAbsoluteUrl(input) {
  try {
    return new URL(input, self.location.origin).toString();
  } catch {
    return self.location.origin + "/";
  }
}

// The application server key is cached by PushSubscriptionManager into a
// stashed Cache entry so pushsubscriptionchange can re-subscribe without
// a round-trip. The cache name is versioned so a VAPID rotation can be
// forced by bumping it.
const APP_KEY_CACHE = "coach-alerts-config-v1";
const APP_KEY_URL = "/__sw-config/vapid-public-key";

async function loadApplicationServerKey() {
  try {
    const cache = await caches.open(APP_KEY_CACHE);
    const match = await cache.match(APP_KEY_URL);
    if (!match) return null;
    const text = (await match.text()).trim();
    if (!text) return null;
    return urlBase64ToUint8Array(text);
  } catch {
    return null;
  }
}

async function postSubscription(subscription) {
  const json = subscription.toJSON();
  const endpoint = typeof json.endpoint === "string" ? json.endpoint : "";
  const keys = json.keys || {};
  if (!endpoint || !keys.p256dh || !keys.auth) return;
  // Same-origin POST — the browser attaches the session cookie if present.
  // The /api/coach/push/subscriptions route handler on the web app is a
  // thin proxy that forwards the authorization token to the Express API.
  const response = await fetch("/api/coach/push/subscriptions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint, keys }),
    credentials: "same-origin",
  });
  if (response.status === 401) {
    // Session expired between SW install and the endpoint rotation. The
    // proxy returns 401; next time the coach opens the app,
    // PushSubscriptionManager will detect the orphan subscription and
    // re-register with a fresh token. Surface it to the dev console so
    // "my notifications stopped" complaints have an on-device trail.
    console.warn(
      "[sw] pushsubscriptionchange re-register got 401; " +
        "session expired. The app will re-register on next open.",
    );
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index++) {
    output[index] = raw.charCodeAt(index);
  }
  return output;
}
