# Isolate integration tests on a dedicated Supabase stack

**Status:** Draft — planning only, no code.
**Branch:** `chore/test-database`
**Related ADR:** [035 — Dedicated test Supabase stack](../decisions/035-test-database-isolation.md)

## Context

Integration tests run against the same local Supabase stack used for manual testing of the dev build. The two workloads share one database, one `auth.users` table, one Mailpit, one cron endpoint. Three symptoms:

- **Collisions.** Tests create rows (profiles, households, lessons, evaluations) in the same schema the manual UI reads from. Unrelated UI state is harder to reason about when tests are running or have recently run.
- **Orphans.** When a test aborts between creating a user and running its cleanup, the row stays. Over time the local DB accumulates `*@test.local` rows and dangling household / audit entries.
- **Clock & cron side-effects.** `coachNoShow`, `cronTickLease`, `coachGoogleCalendarSync`, `coachSwimmersLastLesson`, and the parent-batch-booking suites either call `__setClockForTests` or POST to `/internal/cron/tick`. When those run against the shared DB, lessons that are "future" against wall-clock time but "past" against the pinned clock get promoted to `completed` or `no_show`, which is exactly what the user has been hitting.

The goal of this plan is to send integration tests at their own database, make it impossible for them to touch the manual-test database by accident, and leave `/check` and CI working without ceremony.

## How integration tests connect today

### The stack

`supabase start` (`pnpm db:up`) brings up one project (`project_id = "swim-app"` in `supabase/config.toml`) with these ports:

| Service | Port |
|---|---|
| API (PostgREST / GoTrue / Storage) | 54321 |
| Postgres | 54322 |
| Shadow Postgres | 54320 |
| Studio | 54323 |
| Mailpit web | 54324 |
| Mailpit SMTP | 54325 |
| Pooler (disabled) | 54329 |

Both manual use (`pnpm dev` → `apps/api` dialing the DB) and integration tests target the same `postgres` database on `127.0.0.1:54322`.

### The test entrypoint

`apps/api/package.json`: `"test:integration": "vitest run --config vitest.integration.config.ts"`.

`apps/api/vitest.integration.config.ts`:

- Loads `apps/api/.env` via `dotenv`.
- `include` matches `src/__tests__/integration/**/*.integration.test.ts` (36 suites).
- `fileParallelism: false` — one suite at a time against the one DB.
- 30 s test/hook timeout.

`apps/api/src/__tests__/integration/setup.ts` (runs once before any test file imports the app):

- Requires `INTEGRATION_DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
- Asserts the DB URL hostname is `localhost` / `127.0.0.1` / `::1`.
- Copies `INTEGRATION_DATABASE_URL` → `DATABASE_URL` so `db/client.ts` connects to the integration DB when the app is imported.
- Sets permissive defaults for `APP_ENV=local`, `SITE_URL`, `CRON_SECRET`, `EMAIL_TRANSPORT=smtp`, `EMAIL_FROM`, `EMAIL_SMTP_HOST=127.0.0.1`, `EMAIL_SMTP_PORT=54325`, and VAPID keys so `getEnv()` parses.

`apps/api/src/__tests__/integration/helpers.ts`:

- `createTestUser(prefix)` and `createTestUserInHousehold(prefix, householdId, role)` POST `/auth/v1/admin/users` to create a real Supabase auth user, then sign in with `SUPABASE_PUBLISHABLE_KEY` to obtain a JWT, then `UPDATE profiles SET age_attested_at = now()` so `requireUser` accepts them.
- Each returned `TestUser` carries a `cleanup()` that hard-deletes swimmers (through the RESTRICT FK chain), audit log rows, memberships, the household, the auth user, and the profile row.
- `settleAndCleanupCoachNotificationsForHousehold` and `hardDeleteSwimmer` are shared helpers that the suites call directly.
- Direct DB access is through `adminDb()`, a Drizzle connection on `INTEGRATION_DATABASE_URL` that is kept distinct from the app's pooled client.

### What the suites actually hit

- **Database.** Every suite. Most create households, swimmers, lessons, evaluations.
- **Supabase Auth admin.** `createTestUser` creates a real auth user per test case (via `POST /auth/v1/admin/users` with service role). Many suites create 2–4 users per test.
- **Supabase Auth sign-in.** Same helper calls `/auth/v1/token` via the SDK with the publishable key to get the JWT the tests pass as `Bearer`.
- **Mailpit SMTP (54325).** `EMAIL_SMTP_HOST` + `EMAIL_SMTP_PORT` are set so env parsing succeeds, but every outbox test injects an in-memory transport via `__setSenderTransportForTests`. In practice the real Mailpit port is not dialed.
- **Push transport.** VAPID env is set to satisfy the parser; tests inject their own sender.
- **Clock.** 6 suites import `__setClockForTests` to pin wall-clock time (parent batch booking, coach booking, coach swimmers last lesson, and others).
- **Internal cron.** `cronTickLease`, `coachNoShow`, `coachGoogleCalendarSync` POST to `POST /internal/cron/tick`, which promotes lessons past their end time, settles batches, drains the outbox, etc.
- **Google Calendar.** Tests mock the Google client at the service boundary; no real external calls.
- **Catalog sync.** `skillsCatalogSync.integration.test.ts` runs the real catalog upsert against the test DB.

### CI

`.github/workflows/integration.yml` runs on pull requests to `main`:

1. Checkout, pnpm + Node setup, `pnpm install --frozen-lockfile`.
2. `supabase/setup-cli@v1` at version 2.120.0.
3. `supabase start` on ubuntu-latest.
4. `supabase status -o env`, rename to the names tests expect, write to `$GITHUB_ENV`. `DB_URL` becomes `INTEGRATION_DATABASE_URL`.
5. `pnpm db:migrate` with `DATABASE_URL=$INTEGRATION_DATABASE_URL`.
6. `pnpm test:integration`.
7. `supabase stop` (always).

The runner is ephemeral so isolation is free in CI — the DB is destroyed with the VM.

### Everything that would change

| Surface | Change |
|---|---|
| `supabase/` (dev stack) | Unchanged |
| `supabase-test/config.toml` (new) | New config: different `project_id`, test ports, Studio + Mailpit optionally disabled |
| `apps/api/.env` | Dev-only vars; integration vars removed |
| `apps/api/.env.test` (new) | `INTEGRATION_DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — test-stack values |
| `apps/api/.env.example` | Points integration vars at the test-stack ports |
| `apps/api/vitest.integration.config.ts` | Loads `.env.test` instead of `.env` |
| `apps/api/src/__tests__/integration/setup.ts` | Add a test-target guard (details below) |
| `package.json` | New `db:test:up` / `down` / `status` / `migrate` / `reset` / `sync-catalog` scripts |
| `.github/workflows/integration.yml` | Export `INTEGRATION_TEST_TARGET=1` before running tests so the guard allows the CI stack |
| `CLAUDE.md` | One rule: integration tests target the test stack, never the manual stack |
| `.claude/commands/check.md` | Pre-step note mentions `pnpm db:test:up` not `pnpm db:up` for step 4 |
| `docs/decisions/README.md` | Index entry for ADR 035 |

## Options

### Option A — Second local Supabase stack on different ports (dedicated to tests)

Run two Supabase projects side-by-side: the existing one on 54320–54325 for manual use, a `swim-app-test` project on 54420–54425 for integration tests. Each is a full stack (Postgres, GoTrue, PostgREST, Storage, Mailpit).

Supabase CLI supports multiple projects on one host as long as `project_id` in `config.toml` differs — that string is the Docker container-name prefix, so distinct ids keep the two sets of containers from colliding. Each project needs its own directory (the CLI reads `./supabase/config.toml` relative to `--workdir`).

**Pros**

- Full physical isolation: separate DB, separate `auth.users`, separate Mailpit, separate cron state. Tests cannot touch manual data by any mechanism.
- Both stacks can be up at once, so manual testing and `pnpm test:integration` do not fight for the DB.
- `supabase db reset --workdir supabase-test` wipes the test stack without touching manual data.
- Mirrors CI: one stack per workload, both managed by `supabase start` / `supabase stop`.

**Cons**

- Doubles the Docker footprint on Windows. Each Supabase stack is 6–7 containers and ~1.5–2 GB of resident memory via WSL2. Two stacks is 3–4 GB minimum and noticeably more CPU on cold start. (Mitigation: disable Studio + Storage + Mailpit in the test stack — the tests never dial them, and Mailpit's SMTP env is set only to satisfy env parsing.)
- Two sets of ports to remember. Fixed by keeping them adjacent and documented (54320–54325 manual, 54420–54425 test).
- Migrations run twice: once per stack. Fixed by a `db:test:migrate` script.

### Option B — Separate database inside the same local Postgres

Keep one Supabase stack. Create a second logical database next to `postgres` (e.g. `swim_app_test`). Point `INTEGRATION_DATABASE_URL` at it. Run migrations and tests against the second database only.

**Pros**

- Zero extra Docker cost.
- One `supabase start` to remember.

**Cons — fatal**

- Supabase Auth (GoTrue) binds to a single database — `auth.users` lives in `postgres`, not `swim_app_test`. The integration helpers rely on `POST /auth/v1/admin/users` to create real users and `signInWithPassword` to mint real JWTs; both write to `auth.users` in `postgres`.
- `profiles.id → auth.users.id` is a cross-database FK the moment `profiles` lives in `swim_app_test` and `auth.users` lives in `postgres`. Postgres does not support cross-database FKs, so the `profiles` table in the test DB cannot reference the real `auth.users`.
- The signup trigger `on_auth_user_created` (ADR 004) fires inside `postgres`. It writes `profiles` and `household_members` into whichever DB the trigger function points at, which is the one it was installed in. Teaching GoTrue to write to a second DB would require either duplicating `auth.users` (then the FK to the real auth users is wrong) or running a second GoTrue — at which point we are back at Option A with more plumbing.
- Alternative: skip real auth in integration tests and mint JWTs manually with the same signing secret. But then integration tests no longer cover `/auth/v1/admin/users` → trigger → profile row, which is load-bearing (ADR 004, ADR 017, ADR 034).

Not viable without giving up real-auth coverage, which is the main reason integration tests exist.

### Option C — Dedicated test stack reset before each run

Either shape:

- **C1.** Same single stack; `supabase db reset` before `pnpm test:integration`. Wipes the local manual data every time. Not acceptable — the user's manual lesson plans and seed data would be destroyed on every test run.
- **C2.** Dedicated test stack (as Option A) with `supabase db reset --workdir supabase-test` before each run. ~30–60 s overhead per `pnpm test:integration`. Guarantees no cross-run drift but is expensive during a tight edit-test loop.

C2 is really a modifier on Option A. The right way to express it: ship Option A, keep per-test cleanup, and expose `pnpm db:test:reset` as a one-command escape hatch when the test DB looks dirty — not an automatic step in `test:integration`.

## Recommendation — Option A

Create a `supabase-test/` directory with a slim `config.toml`, run both stacks locally, and gate integration tests on a dedicated target.

### Where the test stack lives

- **Directory:** `supabase-test/` at the repo root, alongside the existing `supabase/`.
- **`project_id`:** `swim-app-test` (so Docker container names are `supabase_<service>_swim-app-test` and don't collide with the manual stack).
- **Ports (+100 from defaults — contiguous, easy to remember):**

  | Service | Default stack | Test stack |
  |---|---|---|
  | API | 54321 | 54421 |
  | DB | 54322 | 54422 |
  | Shadow DB | 54320 | 54420 |
  | Studio | 54323 | 54423 *(disabled)* |
  | Mailpit web | 54324 | 54424 *(disabled)* |
  | Mailpit SMTP | 54325 | 54425 *(disabled; env vars kept for parser)* |
  | Pooler | 54329 | 54429 *(disabled, same as dev)* |

- **Services disabled in the test stack:** Studio (not used by tests), Storage (not used), Mailpit / `local_smtp` (tests inject transports). `auth` and `api` stay on because the helpers dial them. This is the Windows-footprint mitigation.

### How `pnpm test:integration` points at it

1. `apps/api/.env.test` (new, gitignored, generated by the user from `supabase status --workdir supabase-test -o env`) holds the test-stack values of `INTEGRATION_DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
2. `apps/api/vitest.integration.config.ts` loads `.env.test` instead of `.env`:
   ```ts
   dotenvConfig({ path: resolve(__dirname, ".env.test") });
   ```
3. `apps/api/.env` stops carrying `INTEGRATION_DATABASE_URL` and the service role key. Manual-use vars (`DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `CRON_SECRET`, …) stay in `.env`.

### How `/check` points at it

`.claude/commands/check.md` already has a pre-step for step 4: *"Before step 4, check that local Supabase is running. If it isn't, stop and tell me to start it."* Tighten the wording to say the **test** stack (`pnpm db:test:up`), not the manual stack. The command itself does not need to change.

### Guard against running tests against the wrong target

Extend `apps/api/src/__tests__/integration/setup.ts` after the existing localhost check:

```
Refuse to run integration tests unless:
  - hostname is local (existing check), AND
  - ONE of:
      - URL contains the test-stack DB port (":54422/"), OR
      - env INTEGRATION_TEST_TARGET === "1"
```

- Locally, the user must point at port 54422 — which is impossible unless they filled in `.env.test` from the test stack. Running against the manual stack (54322) throws before any test opens a connection.
- CI sets `INTEGRATION_TEST_TARGET=1` because its ephemeral stack still runs on the default port 54322. The guard lets it through on that signal; everything else — ephemerality, physical isolation of the VM — is already true.
- As an extra belt-and-braces check: refuse if `INTEGRATION_DATABASE_URL === DATABASE_URL`. Catches a copy-paste where both end up on the manual port locally.

### What changes in CI

- `.github/workflows/integration.yml` gains `INTEGRATION_TEST_TARGET: "1"` as an env on the `Run integration tests` step (or the whole job).
- Nothing else. CI still runs one stack. No test-stack duplication on the runner.

### What stays the same

- The 36 integration suites and `helpers.ts`. The guard is a drop-in; the tests see the same `INTEGRATION_DATABASE_URL` shape they do today.
- The cleanup contract in each `TestUser`. Tests remain responsible for hard-deleting the rows they create. The test-stack isolation protects manual data; it does not replace cleanup.
- The clock pinning model. Tests pinning the clock no longer touch manual-stack lessons because they no longer share a database.

## Phases

### Phase 1 — Scaffold the test stack
- Add `supabase-test/config.toml` with `project_id = "swim-app-test"`, API port 54421, DB port 54422, shadow 54420, `local_smtp.enabled = false`, `studio.enabled = false`, `storage.enabled = false`, auth enabled with `site_url = http://localhost:3000`.
- Add `pnpm` scripts:
  - `db:test:up` → `supabase start --workdir supabase-test`
  - `db:test:down` → `supabase stop --workdir supabase-test`
  - `db:test:status` → `supabase status --workdir supabase-test`
  - `db:test:reset` → `supabase db reset --workdir supabase-test`
  - `db:test:migrate` → `pnpm --filter api db:migrate` with `DATABASE_URL` from the test stack (likely a tiny wrapper that reads `.env.test`)
  - `db:test:sync-catalog` → same wrapper + `pnpm --filter api db:sync-catalog`
- One-time docs block (in `CLAUDE.md` Database section) explaining the two stacks.

**Exit criterion:** `pnpm db:test:up` brings up a second Supabase stack on 54420–54422 without disturbing the manual stack.

### Phase 2 — Split env files
- Create `apps/api/.env.test` (gitignored) with placeholders mirroring `.env.example`.
- Remove `INTEGRATION_DATABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from `apps/api/.env`.
- Update `apps/api/.env.example`: show both files, point `.env.test` values at port 54422.
- Update `vitest.integration.config.ts` to load `.env.test`.

**Exit criterion:** `pnpm test:integration` runs locally against the test stack with `.env.test` populated.

### Phase 3 — Add the test-target guard
- Extend `apps/api/src/__tests__/integration/setup.ts`:
  - Keep the existing localhost assertion.
  - Add the port 54422 / `INTEGRATION_TEST_TARGET=1` requirement.
  - Add the `INTEGRATION_DATABASE_URL !== DATABASE_URL` check.
- Verify by pointing `.env.test` at port 54322 and confirming the suite refuses to run.

**Exit criterion:** running `pnpm test:integration` against anything other than the test stack or a CI-like environment throws before the first test.

### Phase 4 — CI pass
- Add `INTEGRATION_TEST_TARGET: "1"` to the `Run integration tests` step in `.github/workflows/integration.yml`.
- Dry-run the workflow on this branch to confirm green.

**Exit criterion:** the Integration Tests workflow passes on PR with no other changes.

### Phase 5 — Doc + decision record
- Add ADR 035 to `docs/decisions/` and link it from `docs/decisions/README.md`.
- Update `CLAUDE.md` Database section with the two-stack commands and a one-line rule: *integration tests target the test stack, never the manual stack.*
- Update `.claude/commands/check.md` so the pre-step for step 4 names `pnpm db:test:up`.

**Exit criterion:** docs match code; the rule is discoverable from CLAUDE.md.

## Open decisions for the user

1. **Port range.** Proposed +100 (54420–54425). Fine, or prefer a different block?
2. **Disabled services in the test stack.** Proposed: disable Studio, Storage, and Mailpit (tests inject their own transports and never dial them). Keep auth + API. Any you want kept on for occasional debugging?
3. **Automatic reset on every `test:integration` run?** Proposed: no (adds 30–60 s per run); keep `pnpm db:test:reset` as a manual escape hatch. Fine, or prefer auto-reset?
4. **Keep `.env.test` gitignored or commit the placeholders?** Proposed: gitignore the file; document generation via `supabase status --workdir supabase-test -o env`. Match the existing `.env` posture.
