# Deployment

A step-by-step guide for standing up the hosted stack for the first time. Written against the dev environment; prod uses the exact same steps against a second set of accounts, with the differences called out in [§8](#8-prod-differences).

## Domain plan

Domain: **axiomaquatics.io** (apex is already pointed at Google Workspace for email; existing MX and SPF records must survive).

| Env  | Web                     | API                         |
| ---- | ----------------------- | --------------------------- |
| Prod | axiomaquatics.io + www  | api.axiomaquatics.io        |
| Dev  | dev.axiomaquatics.io    | api-dev.axiomaquatics.io    |

App email: `noreply@axiomaquatics.io` via Resend.

## Hosting accounts

All services are owned by **jason@axiomaquatics.io** for now:

- Supabase (database + auth)
- Railway (API)
- Vercel (web)
- Resend (transactional email)
- Namecheap / registrar for axiomaquatics.io (where the DNS zone lives)
- GitHub (source + CI)

## Services at a glance

| Service          | Role                           | Dev value                                   |
| ---------------- | ------------------------------ | ------------------------------------------- |
| Supabase project | Postgres + auth + email sender | `swim-app-dev` in **West US (us-west-1)**   |
| Railway service  | Express API (`apps/api`)       | `api-dev`, custom domain `api-dev.…`        |
| Vercel project   | Next.js web (`apps/web`)       | `swim-app`, `dev` branch → `dev.…`          |
| Resend domain    | SMTP sender for Supabase       | `axiomaquatics.io`, from `noreply@…`        |
| GitHub repo      | Source + migrations workflow   | `main` → prod, `dev` → dev                  |

---

## 1. Supabase dev project

### 1a. Create the project

1. In Supabase, **New project** under the Axiom Aquatics org.
2. Name: `swim-app-dev`. Region: **West US (us-west-1)** (closest to OC — matches target user base).
3. Save the database password to the shared password manager; it's the only secret Supabase will not re-show.
4. Wait for provisioning.

### 1b. Keys and connection strings to copy

From **Project Settings → API**:

| Supabase screen         | Copy as                      | Used by                                   |
| ----------------------- | ---------------------------- | ----------------------------------------- |
| API URL                 | `SUPABASE_URL`               | API (`apps/api/src/lib/supabase.ts:3`)    |
| API URL                 | `NEXT_PUBLIC_SUPABASE_URL`   | Web (SSR client)                          |
| Project API Keys → anon | `SUPABASE_PUBLISHABLE_KEY`   | API                                       |
| Project API Keys → anon | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Web                             |

From **Project Settings → Database → Connection string → Session pooler** (NOT direct, NOT transaction):

- Copy as `DATABASE_URL` (used by Drizzle migrations and the API at runtime).
- Session pooler is required because the API uses `postgres-js` with persistent connections; direct DB can't survive Railway cold starts, and transaction pooler breaks prepared statements that Drizzle uses.

The service role key **is** required on Railway (the API service) and **only** there. ADR 034's account-deletion flow calls `supabase.auth.admin.deleteUser(…)` in a post-commit task; the service-role key is the credential for that call. Copy **Project API Keys → service_role** to the Railway API service as `SUPABASE_SERVICE_ROLE_KEY` (see §2b). **Never** copy it to Vercel, and **never** expose it in a `NEXT_PUBLIC_*` variable — the web app has no need for service-role privilege and `NEXT_PUBLIC_*` would ship the key to every browser. The env validator (`apps/api/src/lib/env.ts`) now refuses to boot the API without it when `APP_ENV=dev` or `APP_ENV=prod`.

### 1c. Settings to change in Studio

Under **Authentication → URL Configuration**:

- **Site URL**: `https://dev.axiomaquatics.io`
- **Redirect URLs** (add each):
  - `https://dev.axiomaquatics.io/auth/confirm`
  - `https://dev.axiomaquatics.io/auth/confirm?**` (glob — the signup flow appends `&token_hash=…&type=email&returnTo=…`; see `apps/api/src/app.ts:111`)
  - `https://dev.axiomaquatics.io/**` (catch-all for post-auth returns)

These mirror the `additional_redirect_urls` block in `supabase/config.toml:168-172` but with the dev domain instead of localhost.

Under **Authentication → Settings**:

- Enable email signup: **on**
- Confirm email: **on**
- Double confirm email change: **on**
- JWT expiry: **3600s**, refresh token rotation **on**, reuse interval **10s**
- Rate limits: `email_sent=2/hour`, `token_refresh=150/5min`, `sign_in_sign_ups=30/5min`, `token_verifications=30/5min` (match `supabase/config.toml:206-220`)

### 1d. Email templates

Under **Authentication → Email Templates**, paste the HTML from each file in `supabase/templates/`. The subjects are declared in `supabase/config.toml:255-273`:

| Template          | File                                     | Subject                                                  |
| ----------------- | ---------------------------------------- | -------------------------------------------------------- |
| Confirm signup    | `supabase/templates/confirmation.html`   | Confirm your Axiom Aquatics account                      |
| Invite user       | `supabase/templates/invite.html`         | You've been invited to Axiom Aquatics                    |
| Magic link        | `supabase/templates/magic_link.html`     | Your Axiom Aquatics sign-in link                         |
| Change email      | `supabase/templates/email_change.html`   | Confirm your new Axiom Aquatics email address            |
| Reset password    | `supabase/templates/recovery.html`       | Reset your Axiom Aquatics password                       |

All templates reference `{{ .SiteURL }}/logos/axiom-aquatics-lockup.png`, so the logo asset must deploy with the web app (it already lives under `apps/web/public/logos/`).

### 1e. SMTP (Resend)

Under **Authentication → SMTP Settings → Enable Custom SMTP**:

- Host: `smtp.resend.com`
- Port: `465` (TLS) or `587` (STARTTLS)
- Username: `resend`
- Password: Resend API key (create a key under Resend → API Keys with send-only scope)
- Sender email: `noreply@axiomaquatics.io`
- Sender name: `Axiom Aquatics`

Resend requires DNS verification of the sending domain before the first message goes out — see [§7 DNS records](#7-custom-domains-and-dns).

### 1f. Running migrations and catalog sync

Local dev continues to use `pnpm db:migrate` and `pnpm db:sync-catalog` against the local Supabase stack. For the dev project:

```bash
DATABASE_URL='<session-pooler-string>' pnpm db:migrate
DATABASE_URL='<session-pooler-string>' pnpm db:sync-catalog
```

`apps/api/src/db/migrate.ts:7` reads `DATABASE_URL` and applies files from `apps/api/src/db/migrations/`. The GitHub Action in [§4](#4-github) does the same thing on every push to `dev`.

`apps/api/src/db/scripts/syncCatalog.ts` is idempotent (`onConflictDoNothing`), safe to run against any env, and must be re-run after any catalog edit.

Do **not** run `pnpm db:seed` against the hosted dev project unless you want 34 OC-area clubs inserted. The seed is `onConflictDoNothing({ target: clubs.name })`, so it's safe to re-run, but it's not part of the normal deploy.

---

## 2. Railway API service

One Railway project, one service, pointed at this repo.

### 2a. Service settings

- **Root directory**: repo root (so pnpm workspaces resolve)
- **Install command**: `pnpm install --frozen-lockfile`
- **Build command**: _(empty)_ — the API runs via `tsx` at runtime; no build step
- **Start command**: `pnpm --filter api start`
- **Node version**: 24 (set via `NIXPACKS_NODE_VERSION=24` or Railway's auto-detect from `.nvmrc`)
- **Watch paths**: `apps/api/**`, `packages/shared/**` (so edits to web don't redeploy the API)

> Note: `apps/api/package.json` now defines `"start": "tsx src/index.ts"`, and `tsx` is a regular dependency so it's installed in production. A compiled build (tsc or esbuild) is planned before prod; the start command will switch to `node dist/index.js` at that point.

### 2b. Environment variables

Set under **Service → Variables**. Dev values shown.

| Var                        | What it is                                      | Where it's read                                   | Dev value                                                   |
| -------------------------- | ----------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------- |
| `NODE_ENV`                 | Runtime mode — switches logger + CORS fallback  | `apps/api/src/logger.ts:3`, `app.ts:58`           | `production`                                                |
| `PORT`                     | Port Express binds to                           | `apps/api/src/index.ts:6`                         | leave unset — Railway injects it                            |
| `DATABASE_URL`             | Postgres connection string                      | `apps/api/src/db/client.ts:5`, `db/migrate.ts:7`  | Supabase session pooler string from §1b                     |
| `SUPABASE_URL`             | Supabase project API URL                        | `apps/api/src/lib/supabase.ts:3`                  | from §1b                                                    |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase anon key                               | `apps/api/src/lib/supabase.ts:4`                  | from §1b                                                    |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key (ADR 034 account deletion) | `apps/api/src/lib/supabaseAdmin.ts:17`     | **Project API Keys → service_role** from §1b. Railway only; never on Vercel, never `NEXT_PUBLIC_*` |
| `SITE_URL`                 | Public web URL — builds invite + email redirect | `apps/api/src/app.ts:107`, `routes/households.ts:143` | `https://dev.axiomaquatics.io`                          |
| `CORS_ORIGINS`             | Allow-list for CORS (comma-separated)           | `apps/api/src/app.ts:49`                          | `https://dev.axiomaquatics.io`                              |
| `TRUST_PROXY`              | Reverse-proxy hops to trust for `req.ip`        | `apps/api/src/app.ts:44`                          | `1` (Railway = 1 proxy hop; required for rate limiter)      |
| `CRON_SECRET`              | Secret header for `/internal/cron/tick`         | `apps/api/src/routes/internal.ts:21`              | `openssl rand -hex 32` → paste result                       |

**Watch out**: `CORS_ORIGINS` has a dev-only fallback to `http://localhost:3000` (`app.ts:58-64`). In production, if the var is unset the array is empty and every cross-origin preflight fails silently. Set it explicitly.

### 2c. Custom domain

**Service → Settings → Networking → Custom Domain**: add `api-dev.axiomaquatics.io`. Railway returns a CNAME target like `<service>-<project>.up.railway.app` — put that in DNS ([§7](#7-custom-domains-and-dns)). Railway provisions a Let's Encrypt cert within a few minutes.

### 2d. Cron job

Railway has native cron. Under **Service → Settings → Cron**:

- Schedule: `*/5 * * * *` (every 5 minutes — expires pending lessons and auto-completes approved lessons past their end time)
- Command: `curl -fsS -X POST -H "cron-secret: $CRON_SECRET" "$INTERNAL_URL/internal/cron/tick"`
- Set service env vars for the cron: `INTERNAL_URL=http://localhost:$PORT` (same service, so the cron hits the API over the Railway private network with no auth round-trip over the public internet).

The route is defined at `apps/api/src/routes/internal.ts:37-81` and uses `timingSafeEqual` on SHA-256 digests of the header vs env. Missing or wrong secret → 401.

---

## 3. Vercel web app

One Vercel project. The `dev` branch deploys to the dev subdomain; `main` deploys to prod. Preview deployments on PRs stay off until we're ready to spend on Vercel Pro.

### 3a. Project settings

- **Framework preset**: Next.js (auto-detected)
- **Root directory**: `apps/web`
- **Build command**: `pnpm --filter web... build` _(leave as Vercel default, which is `next build`)_
- **Install command**: `cd ../.. && pnpm install --frozen-lockfile` _(Vercel's Next.js detector handles this automatically for `apps/web` roots in pnpm workspaces; override only if the default install misses `packages/shared`)_
- **Output directory**: `.next` (default)
- **Node version**: 24
- **Production branch**: `main`
- **Deploy on `dev` branch**: on (Vercel calls these "preview deployments on a non-production branch")

### 3b. Environment variables

Vercel supports per-environment values (**Production**, **Preview**, **Development**). Set each var under the right scope.

| Var                                        | What it is                                   | Where it's read                                                                 | Dev value (Preview on `dev`)                       |
| ------------------------------------------ | -------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------- |
| `NEXT_PUBLIC_API_URL`                      | Base URL for every API fetch (~70 call sites) | `apps/web/src/content/**/actions.ts`, `apps/web/src/lib/**` (grep for the var)  | `https://api-dev.axiomaquatics.io`                 |
| `NEXT_PUBLIC_SITE_URL`                     | Public web URL — used for metadata + auth    | `apps/web/src/app/layout.tsx:23`, `app/auth/confirm/route.ts:7`, login + signup actions | `https://dev.axiomaquatics.io`             |
| `NEXT_PUBLIC_SUPABASE_URL`                 | Supabase project API URL                     | `apps/web/src/lib/supabase/server.ts:7`, `updateSession.ts:8`                   | from §1b                                           |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`     | Supabase anon key                            | `apps/web/src/lib/supabase/server.ts:8`, `updateSession.ts:9`                   | from §1b                                           |

Set the same four vars under **Production** scope using the prod values once prod exists (§8). Vercel **never** receives `SUPABASE_SERVICE_ROLE_KEY` — that credential lives on Railway only (the API's account-deletion flow is its only consumer; see §1b). Don't put it in any `NEXT_PUBLIC_*` variable either — those are inlined into the browser bundle.

> `NEXT_PUBLIC_API_URL` has no default anywhere in the code. If missing, every `fetch(\`${process.env.NEXT_PUBLIC_API_URL}/...\`)` becomes `fetch("undefined/...")` and fails immediately. Make sure both Production and Preview scopes have it set.

### 3c. Custom domain

**Project → Domains**: add `dev.axiomaquatics.io` and assign it to the `dev` branch. Vercel will show the DNS record it needs — see [§7](#7-custom-domains-and-dns). Add `axiomaquatics.io` + `www.axiomaquatics.io` later for prod.

---

## 4. GitHub

### 4a. Create the dev branch

From the current state of `main`:

```bash
git checkout main
git pull
git checkout -b dev
git push -u origin dev
```

### 4b. Branch protection

**Settings → Branches → Branch protection rules**, create one rule for each branch:

**`main`** (prod):
- Require pull request before merging
- Require status checks: `Typecheck, lint, test, build`, `API integration tests`
- Require branches to be up to date before merging
- Do not allow force pushes
- Do not allow deletions

**`dev`**:
- Require pull request before merging (so dev always matches a reviewed PR)
- No required status checks — PRs into `dev` do not trigger GitHub Actions. The local pre-push hook ([§4e](#4e-local-pre-push-checks-and-ci-split)) is the gate for `dev`.
- Allow force push: **off**
- Allow deletions: **off**

Direct pushes to `dev` by maintainers can stay allowed if we want to hotfix the dev env without a PR — your call. The pre-push hook still runs on direct pushes.

### 4c. Secrets

**Settings → Secrets and variables → Actions → New repository secret**:

| Secret                    | Value                                                       | Used by                             |
| ------------------------- | ----------------------------------------------------------- | ----------------------------------- |
| `DEV_DATABASE_URL`        | Supabase dev session-pooler connection string (from §1b)    | `.github/workflows/dev-migrations.yml` |

Prod's `PROD_DATABASE_URL` goes in later as a separate secret and is only referenced by a manual workflow.

### 4d. Migrations workflow

The workflow at `.github/workflows/dev-migrations.yml` runs on every push to `dev` and applies migrations + catalog sync against the dev project. It does **not** run on `main`; prod migrations stay manual (see [§8](#8-prod-differences)).

File is committed on this branch. Steps:

1. Checkout
2. pnpm + Node 24
3. `pnpm install --frozen-lockfile`
4. `pnpm db:migrate` with `DATABASE_URL=${{ secrets.DEV_DATABASE_URL }}`
5. `pnpm db:sync-catalog` with the same env

### 4e. Local pre-push checks and CI split

Correctness checks run locally on every push via a husky pre-push hook; GitHub Actions only re-runs them for PRs into `main`. This keeps the dev loop cheap in Actions minutes while still gating prod merges.

**Local (husky `.husky/pre-push`)** — runs on every `git push`, including pushes to feature branches and `dev`:

1. `pnpm typecheck`
2. `pnpm lint`
3. `pnpm test`
4. `pnpm --filter web build`

Steps run in order and stop at the first failure, printing which step failed. Never bypass with `--no-verify`. Integration tests are **not** in the hook (they need the local Supabase stack); run `pnpm test:integration` yourself before opening a PR.

**GitHub Actions** — only for PRs into `main`:

| Workflow | Trigger | What it runs |
| --- | --- | --- |
| `pr-checks.yml` | `pull_request` into `main` (opened, synchronize, reopened, ready_for_review) | typecheck + lint + test + web build, one job |
| `integration.yml` | same | `pnpm test:integration` against a fresh local Supabase stack |
| `dev-migrations.yml` | push to `dev` | migrations + catalog sync against hosted dev — unchanged |

Both PR workflows skip drafts, cancel superseded runs via `concurrency`, and timeout per job to cap minutes.

**Typical flow:**

1. Branch off `dev`, commit, push → pre-push hook runs locally. No Actions.
2. Open PR into `dev`. No Actions. Review by eye; merge.
3. Push to `dev` → `dev-migrations.yml` runs migrations against hosted dev.
4. Open PR from `dev` into `main` → `pr-checks.yml` + `integration.yml` run as required status checks.
5. Merge to `main` → operator runs prod migrations manually ([§8](#8-prod-differences)).

---

## 5. Connecting the pieces

With all three services provisioned, these cross-wires let them talk to each other. If anything in this section is wrong, auth and API calls will fail.

| Service   | Setting                      | Dev value                                                             |
| --------- | ---------------------------- | --------------------------------------------------------------------- |
| Supabase  | Site URL                     | `https://dev.axiomaquatics.io`                                        |
| Supabase  | Redirect URLs                | `https://dev.axiomaquatics.io/auth/confirm`, `…/auth/confirm?**`, `…/**` |
| Railway   | `CORS_ORIGINS`               | `https://dev.axiomaquatics.io`                                        |
| Railway   | `SITE_URL`                   | `https://dev.axiomaquatics.io`                                        |
| Vercel    | `NEXT_PUBLIC_API_URL`        | `https://api-dev.axiomaquatics.io`                                    |
| Vercel    | `NEXT_PUBLIC_SITE_URL`       | `https://dev.axiomaquatics.io`                                        |

Resend's sender address (`noreply@axiomaquatics.io`) matches the From field in Supabase SMTP settings — the two must agree exactly, including the display name, or Resend will refuse to send.

---

## 6. Smoke test checklist

Run through this on dev after every full deploy. The whole flow should take under 10 minutes with real email delivery.

- [ ] `GET https://api-dev.axiomaquatics.io/health` returns `200` with `{"ok":true,"db":true,…}`
- [ ] `GET https://dev.axiomaquatics.io/` loads and shows the signed-out homepage
- [ ] Create an account at `/signup` with a fresh email — API returns `201`
- [ ] Receive the confirmation email from `noreply@axiomaquatics.io` within 2 minutes
- [ ] Click the link — lands on `/dashboard` (not `/login?notice=link-expired`)
- [ ] Log out, log back in — session persists across a hard reload
- [ ] Owner adds a swimmer, picks a club from the searchable picker
- [ ] Book a lesson — see it in `/dashboard` as `pending`
- [ ] Sign in as a coach account (seed one manually in Supabase Studio, role=`coach`), approve the lesson — see it move to `approved`
- [ ] As coach, rate the swimmer on a skill — rating is saved and shows in the rubric
- [ ] `/leaderboard` loads with no errors (empty state is fine on a fresh dev project)
- [ ] Trigger cron manually: `curl -X POST -H "cron-secret: <SECRET>" https://api-dev.axiomaquatics.io/internal/cron/tick` → `{"expired":0,"completed":…}`

---

## 7. Custom domains and DNS

Add these after the free `*.vercel.app` and `*.up.railway.app` URLs work end-to-end. All records go in the DNS zone for `axiomaquatics.io` (wherever the registrar is).

### Keep existing records

Google Workspace already owns:

- `MX` on apex → Google (five records at priority 1-10)
- `TXT` on apex → `v=spf1 include:_spf.google.com ~all`
- Possibly `TXT` on `google._domainkey` for DKIM

**Do not remove or duplicate these.** Only one `TXT` record of type SPF (`v=spf1`) may exist per name; adding a second breaks mail delivery.

### Vercel (web)

| Name                     | Type  | Value                     | Notes                           |
| ------------------------ | ----- | ------------------------- | ------------------------------- |
| `axiomaquatics.io` (apex) | `A`   | `76.76.21.21`             | Vercel's anycast IP (prod only) |
| `www`                    | `CNAME` | `cname.vercel-dns.com`  | prod                            |
| `dev`                    | `CNAME` | `cname.vercel-dns.com`  | dev                             |

Vercel's domain-add dialog shows the exact value for each; use whatever it displays.

### Railway (API)

| Name       | Type    | Value                                          | Notes |
| ---------- | ------- | ---------------------------------------------- | ----- |
| `api`      | `CNAME` | `<prod-service>.up.railway.app` (from Railway) | prod  |
| `api-dev`  | `CNAME` | `<dev-service>.up.railway.app` (from Railway)  | dev   |

### Resend (email)

Resend's dashboard, under **Domains → Add Domain → axiomaquatics.io**, lists the exact records it needs. Typically it's:

| Name                               | Type  | Value                                                       | Purpose                 |
| ---------------------------------- | ----- | ----------------------------------------------------------- | ----------------------- |
| `send.axiomaquatics.io`            | `MX`  | `feedback-smtp.us-east-1.amazonses.com` (priority 10)       | Bounce handling         |
| `send.axiomaquatics.io`            | `TXT` | `v=spf1 include:amazonses.com ~all`                         | SPF for Return-Path     |
| `resend._domainkey.axiomaquatics.io` | `TXT` | long DKIM public key from Resend                          | DKIM signing            |

The SPF record above goes on the **`send.` subdomain**, not the apex, so it coexists with Google's existing apex SPF without conflict. Resend uses the `send.` subdomain as the Return-Path and relies on relaxed SPF alignment (same organizational domain).

### DMARC (recommended)

| Name                       | Type  | Value                                                                                   |
| -------------------------- | ----- | --------------------------------------------------------------------------------------- |
| `_dmarc.axiomaquatics.io`  | `TXT` | `v=DMARC1; p=none; rua=mailto:dmarc-reports@axiomaquatics.io; adkim=r; aspf=r;`         |

Start with `p=none` (monitor only), check Resend + Google reports for a week, then move to `p=quarantine` and eventually `p=reject`.

### If you ever send from the apex directly

If a future app sends email with `From: noreply@axiomaquatics.io` **and** the Return-Path is also on the apex (not on `send.`), SPF needs to live on the apex. In that case, **merge** Google and Resend into one record — never two:

```
v=spf1 include:_spf.google.com include:amazonses.com ~all
```

Delete the Google-only record first, then add the merged one. Two separate `v=spf1` TXT records on the same name is a hard-fail for all senders.

---

## 8. Prod differences

Prod goes through all the same steps as dev, with these changes:

**Separate Supabase project**: `swim-app-prod`, same region (us-west-1), its own password, its own anon key, its own session-pooler `DATABASE_URL`. No data copied from dev.

**Separate Railway service**: `api-prod`, custom domain `api.axiomaquatics.io`. Env vars identical to dev's but with prod values: `SITE_URL=https://axiomaquatics.io`, `CORS_ORIGINS=https://axiomaquatics.io,https://www.axiomaquatics.io`, prod Supabase keys (anon + service_role), a fresh `CRON_SECRET`.

**Vercel production branch**: `main`. Set the Production-scope env vars with prod values. Preview deployments on PRs still off (or paid plan if we want them on).

**Manual migrations**: no GitHub Action runs against prod. The release process is:

1. Merge PR to `main`.
2. Operator opens a shell, exports `PROD_DATABASE_URL`, runs `pnpm db:migrate`.
3. If the migration changes the catalog, run `pnpm db:sync-catalog` too.
4. Vercel auto-deploys `main` to prod after step 2 completes successfully.

> **Migration 0042** (`backfill_season_end_date`) backfills `end_date` for all existing availability seasons, using the next season's `start_date − 1 day` where available, or `start_date + 3 months` for the last season. After running `pnpm db:migrate`, verify the `availability_seasons` table has no NULL `end_date` rows before deploying the API.

If a prod migration needs to be rolled back, Supabase point-in-time recovery is on by default on the Pro plan — see §Launch checklist.

**Paid plans before launch**: Supabase Free pauses projects after 7 days of inactivity and has no PITR. Vercel Hobby is non-commercial. Both need paid plans before real users:

- Supabase Pro ($25/mo per project) — PITR, longer backups, custom SMTP alt, no pausing
- Vercel Pro ($20/mo per seat) — commercial use + preview comments + better bandwidth

Railway is already pay-as-you-go.

### Launch checklist

- [ ] Prod Supabase on Pro plan; verify PITR is enabled
- [ ] Prod Supabase daily backups verified (download one, check restore)
- [ ] Vercel on Pro plan; prod domain on prod project; `main` is production branch
- [ ] Resend domain verified (DKIM green, SPF green)
- [ ] DMARC in `p=quarantine` or `p=reject` with a monitored `rua=` mailbox
- [ ] Prod `CRON_SECRET` is a fresh value (not reused from dev)
- [ ] Prod `SUPABASE_SERVICE_ROLE_KEY` is set on the Railway API service only (never on Vercel, never in `NEXT_PUBLIC_*`); API refuses to boot without it under `APP_ENV=prod`
- [ ] Prod Railway cron is firing — check logs for `cron/tick` entries every 5 min
- [ ] Smoke test ([§6](#6-smoke-test-checklist)) passes on prod
- [ ] Someone besides the owner has recovery access to Supabase, Vercel, Railway, Resend, and the DNS zone

---

## Appendix: code that previously assumed localhost — now fixed

Each row below used to be either an env-var default pointing at `localhost` or a dev-only fallback that would silently activate in production if a var was unset. All of them are now hardened: `apps/api/src/lib/env.ts` and `apps/web/src/lib/env.ts` validate required env vars at startup/build with Zod and refuse to run with missing or localhost values in production.

| File                                              | Previous behavior                                                                        | Status                                                                                                                 |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/index.ts`                           | `logger.info("http://localhost:${port}")` startup line                                   | **Fixed** — startup log now reads from `env.port` and prints "listening on port N"; env parse exits before bind if invalid. |
| `apps/api/src/app.ts` (CORS)                      | `CORS_ORIGINS` default empty; non-prod fallback to `http://localhost:3000`               | **Fixed** — `parseEnv` rejects empty `CORS_ORIGINS` when `NODE_ENV=production`; dev-only fallback is unchanged.         |
| `apps/api/src/app.ts` (SITE_URL)                  | `SITE_URL = … ?? "http://localhost:3000"` for signup `emailRedirectTo`                   | **Fixed** — reads `env.siteUrl`; `parseEnv` rejects a localhost `SITE_URL` in production.                              |
| `apps/api/src/routes/households.ts`               | Invite URL built from `SITE_URL` with localhost fallback                                 | **Fixed** — reads `getEnv().siteUrl`; same production guard applies.                                                   |
| `apps/web/src/app/layout.tsx`                     | `metadataBase: new URL(NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000")`                 | **Fixed** — reads `publicEnv.siteUrl`; `parsePublicEnv` requires it to be a valid URL at build time.                   |
| `apps/web/src/app/auth/confirm/route.ts`          | `SITE_ORIGIN = NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"` for `isSafeReturnTo`     | **Fixed** — reads `publicEnv.siteUrl`; env validation guarantees it's set.                                             |
| `apps/web/src/content/LoginContent/actions.ts`    | Same `SITE_ORIGIN` fallback for login returnTo validation                                | **Fixed** — reads `publicEnv.siteUrl`.                                                                                 |
| `apps/web/src/content/SignupContent/actions.ts`   | Same `SITE_ORIGIN` fallback for signup returnTo validation                               | **Fixed** — reads `publicEnv.siteUrl`.                                                                                 |
| `apps/web` fetch call sites (~70)                 | `fetch(\`${NEXT_PUBLIC_API_URL}/…\`)` with no default — would resolve to `"undefined/…"` | **Fixed** — `next.config.ts` pre-flight check and `parsePublicEnv` both fail the build if `NEXT_PUBLIC_API_URL` is missing. Call sites unchanged (Next inlines the value at build time). |
| `apps/web/src/lib/supabase/server.ts` + `updateSession.ts` | SSR cookie writer uses `@supabase/ssr` defaults — no explicit `secure`/`sameSite`/`domain` | **Not a localhost issue** — Supabase sets `Secure` + `SameSite=Lax` automatically on HTTPS. Left as-is.               |

With these in place, a hosted environment missing any required var fails fast at startup or build with a clear message naming the variable, instead of silently falling back to localhost.
