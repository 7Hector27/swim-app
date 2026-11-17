import type { NextConfig } from "next";
import path from "path";

// Fail the build early if any required NEXT_PUBLIC_* var is missing. The full
// Zod validation lives in src/lib/env.ts and runs again when the root layout
// renders; this check is a defensive pre-flight so build logs point directly
// at the missing variable instead of a cryptic render error.
const requiredPublicEnv = [
  "NEXT_PUBLIC_API_URL",
  "NEXT_PUBLIC_SITE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  // VAPID public key is validated by the Zod schema in src/lib/env.ts
  // (optional on local, enforced on dev/prod via Railway variable sets).
  // The pre-flight only guards the fields that would otherwise crash
  // builds with a cryptic undefined-URL render error.
] as const;

const isProductionBuild =
  process.env.NEXT_PHASE === "phase-production-build" || process.env.NODE_ENV === "production";

if (isProductionBuild) {
  const missing = requiredPublicEnv.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `Invalid web environment configuration:\n${missing
        .map((name) => `  - ${name} is required`)
        .join("\n")}`,
    );
  }
}

// Content-Security-Policy, delivered Report-Only for now. This is the
// first pass: we want to see any legitimate requests that get flagged as
// violations in the browser console before promoting to an enforcing
// header. Each directive below names only the origins the app actually
// touches at runtime:
//
// - `default-src 'self'`: baseline — nothing loads from another origin
//   unless a more specific directive allows it.
// - `script-src 'self'`: no third-party scripts. Stripe.js is NOT in the
//   bundle; checkout is a full-page navigation to checkout.stripe.com.
// - `style-src 'self' 'unsafe-inline'`: Tailwind v4 injects runtime styles
//   via inline <style> blocks, so `unsafe-inline` for style is required.
//   Next.js's streaming dev overlay also relies on inline styles.
// - `img-src 'self' data: blob:`: `data:` covers icon fonts / small inline
//   assets and `blob:` covers client-generated blob URLs (e.g. for file
//   preview during an upload).
// - `font-src 'self'`: `next/font/google` self-hosts the font files at
//   build time, so no runtime request to fonts.googleapis.com /
//   fonts.gstatic.com is made.
// - `connect-src`: fetches go to our own API and to Supabase. The API
//   host is derived from NEXT_PUBLIC_API_URL at build time so dev /
//   staging / prod each ship with their own Railway hostname instead of
//   a hardcoded guess (dev is api-dev-<hash>.up.railway.app, not
//   api-dev.axiomaquatics.io). Supabase stays on the wildcard so the
//   same bundle works across project slugs.
// - `worker-src 'self'`: service worker at `/sw.js` for coach push alerts.
// - `manifest-src 'self'`: PWA manifest at `/icons/site.webmanifest`.
// - `frame-ancestors 'none'`: the app is never embedded in another site.
// - `form-action 'self'`: no cross-origin form POSTs. Stripe checkout is
//   a navigation, not a form submission, so no stripe.com entry needed.
// - `base-uri 'self'`: locks down <base href>.
// - `object-src 'none'`: no Flash / applet / embedded plugins.
//
// Report-only means the browser logs violations but doesn't block them.
// After watching a release's console, promote to the enforcing header.

// Parse the API origin from NEXT_PUBLIC_API_URL. On production builds the
// pre-flight check above has already asserted the var is present, so the
// parse is expected to succeed; in local `next dev` it should be set in
// .env.local. If the URL is malformed we skip the entry rather than
// emitting a broken CSP — the report-only header still delivers and the
// missing origin surfaces as a violation in the browser console.
function deriveApiOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_API_URL;
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

const apiOrigin = deriveApiOrigin();
const connectSrc = ["'self'", "https://*.supabase.co", apiOrigin]
  .filter((entry): entry is string => entry !== null)
  .join(" ");

const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src ${connectSrc}`,
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  // Audit item 1 — strip framework fingerprinting header set by Next.js.
  // Separately, the config has `poweredByHeader: false` below. This entry
  // is a belt-and-suspenders for any edge case where a proxy re-adds it.
  { key: "X-Powered-By", value: "" },
  // Audit item 14 — defense against clickjacking. `X-Frame-Options: DENY`
  // covers older browsers; `frame-ancestors 'none'` in the CSP covers
  // modern ones. We set both.
  { key: "X-Frame-Options", value: "DENY" },
  // MIME-type sniffing hardening — stops a browser from re-interpreting a
  // served file as a different content-type and executing it.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Leak the origin but not the path on cross-origin navigations. Keeps
  // referrers useful for analytics to the same-site pages while hiding
  // query strings (which can contain return-to tokens) from outbound
  // links.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Lock down powerful browser APIs that the app doesn't use. If a future
  // feature needs one of these, add the origin here. `interest-cohort=()`
  // opts the site out of Google's FLoC advertising-cohort computation.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  // Audit item 18 — minimum-necessary CSP in report-only. See CSP_REPORT_ONLY
  // for directive-by-directive rationale. Promote to the enforcing
  // `Content-Security-Policy` header after one release of clean console logs.
  { key: "Content-Security-Policy-Report-Only", value: CSP_REPORT_ONLY },
];

const config: NextConfig = {
  outputFileTracingRoot: path.join(__dirname, "../../"),
  // Audit item 1 — stop emitting `X-Powered-By: Next.js`.
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default config;
