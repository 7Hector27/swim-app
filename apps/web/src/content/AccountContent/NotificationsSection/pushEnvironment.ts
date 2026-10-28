// Browser-detection helpers for the push enable flow. Pure functions so
// they can be unit-tested without jsdom's lack of PushManager tripping
// anything. Call sites run inside useEffect so this never executes on
// the server; still, guard with typeof window checks to make
// server-render safety obvious.

export type SupportState =
  // Browser lacks ServiceWorker or PushManager — not fixable from inside
  // the app, show the "unsupported" message.
  | "unsupported"
  // iPhone Safari that hasn't been added to the home screen yet. iOS
  // 16.4+ supports Web Push *only* when running as an installed PWA. We
  // detect this via `standalone === false` on iOS and show the Add-to-
  // Home-Screen steps instead of the Enable button.
  | "ios-not-installed"
  // Browser supports push — permission state determines the next step.
  | "ready";

export function detectSupport(): SupportState {
  if (typeof window === "undefined") return "unsupported";
  if (!("serviceWorker" in navigator)) return "unsupported";
  if (!("PushManager" in window)) return "unsupported";
  if (!("Notification" in window)) return "unsupported";
  if (isIosSafari() && !isInStandaloneMode()) return "ios-not-installed";
  return "ready";
}

export function isIosSafari(): boolean {
  if (typeof window === "undefined") return false;
  const userAgent = window.navigator.userAgent;
  const isIosDevice = /iPad|iPhone|iPod/.test(userAgent) || (
    // iPadOS 13+ reports as desktop Safari; the touch count distinguishes.
    userAgent.includes("Macintosh") && "ontouchend" in document
  );
  return isIosDevice;
}

export function isInStandaloneMode(): boolean {
  if (typeof window === "undefined") return false;
  // iOS Safari pre-16.4 uses the non-standard navigator.standalone; modern
  // browsers use the display-mode media query. Check both so a future iOS
  // alignment with the standard doesn't break detection.
  const iosLegacy = (navigator as unknown as { standalone?: boolean }).standalone === true;
  const displayMode = window.matchMedia?.("(display-mode: standalone)").matches ?? false;
  return iosLegacy || displayMode;
}

export function getPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

// Browser's base64url-encoded VAPID public key → Uint8Array for subscribe().
// Mirrors the service worker's helper of the same name.
export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index++) {
    output[index] = raw.charCodeAt(index);
  }
  return output;
}

// Rough "Chrome on macOS" style label for the devices list. Trimmed from a
// raw user-agent so the server-side logger never has to inspect UA
// strings. Falls back to "Unknown browser" on empty UA.
export function describeUserAgent(userAgent: string | null): string {
  if (!userAgent) return "Unknown device";
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Firefox\//.test(userAgent)
      ? "Firefox"
      : /Chrome\//.test(userAgent)
        ? "Chrome"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : "Browser";
  const os = /iPhone|iPad|iPod/.test(userAgent)
    ? "iOS"
    : /Android/.test(userAgent)
      ? "Android"
      : /Mac OS X/.test(userAgent)
        ? "macOS"
        : /Windows/.test(userAgent)
          ? "Windows"
          : /Linux/.test(userAgent)
            ? "Linux"
            : "device";
  return `${browser} on ${os}`;
}
