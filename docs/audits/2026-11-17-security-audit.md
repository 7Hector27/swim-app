# Security audit — 2026-11-17

Branch: `chore/security-audit` (off `dev`).
Scope: read-only. No code changes.

Finding format per item:
- **Status** — `safe` / `issue` / `not applicable` / `needs manual check`
- **Evidence** — `file:line` or config path
- **Why it matters here** — one or two sentences tying the generic class to this app
- **Fix** — concrete action
- **Size** — S / M / L

Deployment context: `apps/web` is Next.js 15 on Vercel; `apps/api` is Express on Railway; Supabase provides Postgres + auth. Domain inventory per `docs/deployment.md:7-34`.

---

## Summary

### Counts by status

| Status | Count |
|---|---|
| issue | 7 |
| needs manual check | 1 |
| safe | 9 |
| not applicable | 3 |
| **total** | **20** |

### Top issues ranked by risk

1. **Item 10 — `requireUser` does not enforce `email_confirmed_at`.** Pre-hijacking surface: anyone who gets a Supabase session (whether the dashboard's "Confirm email" is on or off) can reach any `requireUser`-gated route. Needs both a dashboard toggle and a middleware line.
2. **Item 4 — `household_invites` has no RLS enable.** Defense-in-depth gap: every other table has `ENABLE ROW LEVEL SECURITY`, this one slipped through at migration 0008. One-line custom migration.
3. **Item 12 — Secret-strength validators missing.** `SUPABASE_SERVICE_ROLE_KEY`, VAPID keys, and Stripe / Resend keys have no min-length / shape check in the env Zod schema. A truncated paste boots cleanly and only breaks at first use.
4. **Item 18 — No CSP on the web app.** XSS + supply-chain mitigation gap. Attack surface is small (self-hosted fonts, no third-party scripts, Stripe via full-page nav), so a tight CSP is quick to land.
5. **Item 14 — No `X-Frame-Options` / `frame-ancestors` on the web app.** Any site can `<iframe>` `axiomaquatics.io` for UI-redress on authenticated pages (book-lesson, delete-account, top-up).
6. **Item 8 — Login has no app-side rate limit.** Login runs `supabase.auth.signInWithPassword` directly from a Vercel server action; the Express `authEmailLimiter` never sees it. Protection is whatever's configured in the Supabase dashboard.
7. **Item 1 — `X-Powered-By: Next.js` header.** Low-signal framework fingerprinting, but a one-line fix.

### Manual checks for Hector (no code changes)

- **Supabase dashboard — Auth settings.** Confirm each of these before relying on items 8, 10, 12:
  - Providers → Email → **Confirm email: ON** (gates item 10 from the user-creation side).
  - Rate Limits → sign-ins, sign-ups, OTP verifies, token refreshes all set to sensible numbers.
  - **CAPTCHA (hCaptcha / Turnstile)** enabled for sign-in and sign-up.
  - Sessions → **JWT expiry** ≤ 1 h, **Refresh token rotation** on with short reuse-interval.
  - Email → **OTP length ≥ 6**, OTP expiry ≤ 15 min.
  - **Secure email change: ON**.
  - **Rotate the service role key** if it was ever pasted into a shell history, PR, screenshot, or chat.
- **DNS verification (item 17).** Walk the subdomain checklist in the Requests & redirects section. `send.axiomaquatics.io` is the highest-value target (DKIM-aligned mail).
- **Production response headers.** After any fix lands, `curl -sI https://axiomaquatics.io` to confirm `X-Powered-By` is gone, CSP is present, and `X-Frame-Options`/frame-ancestors are set. `curl -sI https://axiomaquatics.io/.git/config` should return 404 (item 2 sanity check).
- **No source maps in prod bundle.** After any build, `find apps/web/.next -name "*.map"` should return nothing on Vercel's deployed output as well.

---

## Info leaks

### 1. X-Powered-By / version headers

- **Status:** issue (web); safe (api).
- **Evidence:** `apps/web/next.config.ts:33-37` — `const config: NextConfig = { outputFileTracingRoot: ... };`. No `poweredByHeader: false`, so Next.js emits `X-Powered-By: Next.js` by default. API side: `apps/api/src/app.ts:58` — `app.use(helmet())`. Helmet's defaults call `app.disable("x-powered-by")`, so Express's header is stripped.
- **Why it matters here:** The prod domain advertises the framework to CVE-matched scanners. Low signal for this app since there are no exploitable public Next.js CVEs in the pinned version right now, but free to remove.
- **Fix:** Add `poweredByHeader: false` to the `NextConfig` object in `apps/web/next.config.ts`.
- **Size:** S.

### 2. `.git` folder exposure

- **Status:** safe.
- **Evidence:** `apps/web/public/` contains only `icons/`, `images/`, `logos/`, `social/`, `sw.js` — no `.git`, no dotfiles. `apps/api/src/app.ts` has no `express.static()` call. No `vercel.json` / `railway.toml` at repo root that would serve arbitrary paths. `.gitignore` top level already excludes build outputs.
- **Why it matters here:** Not an Apache/PHP-style static host, so `.git/*` cannot be served. The historical concern (full repo clone, including historical secrets) doesn't apply to Vercel/Railway's deployment model.
- **Fix:** None. Sanity-check on prod with `curl -I https://axiomaquatics.io/.git/config` returning 404.
- **Size:** —.

### 3. Source maps in production

- **Status:** safe.
- **Evidence:** `apps/web/next.config.ts` — `productionBrowserSourceMaps` is not set (Next 15 default is `false`). `apps/web/tsconfig.json:7` — `"noEmit": true` with no `sourceMap` key; `tsc` emits nothing. After the last clean build, `find apps/web/.next -name "*.map"` returned zero results; only `.js` chunks in `.next/static/chunks/`.
- **Why it matters here:** Shipped maps would expose server action names, Zod schemas, and auth flow internals.
- **Fix:** None. Keep `productionBrowserSourceMaps` unset.
- **Size:** —.
