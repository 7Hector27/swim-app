# Decision records

| # | Title |
|---|-------|
| [001](001-pnpm-monorepo.md) | pnpm workspaces monorepo |
| [002](002-supabase-local-stack.md) | Supabase local stack replaces docker-compose Postgres |
| [003](003-api-enforces-permissions-rls-deny-all.md) | API enforces permissions, RLS set to deny-all |
| [004](004-profiles-table-signup-trigger-role.md) | profiles table, signup trigger, role never from signup metadata |
| [005](005-age-check-no-birthdate-stored.md) | Age check at signup, birth date never stored |
| [006](006-roles-checked-in-db-not-jwt.md) | App roles checked in the database on every request, not in the JWT |
| [007](007-node-version-nvmrc.md) | Node version pinned with .nvmrc (24) |
| [008](008-no-git-hooks-ci-is-the-gate.md) | No git hooks (lefthook removed), CI is the gate |
| [009](009-no-openapi-docs-yet.md) | No OpenAPI docs yet |
| [010](010-claude-code-setup.md) | Claude Code setup |
| [011](011-three-environments.md) | Three environments: local, dev, prod |
| [012](012-design-token-system-and-theming.md) | Design token system and theming |
| [013](013-theme-toggle-light-default.md) | Theme toggle, light default |
| [014](014-supabase-ssr-web-auth.md) | Supabase SSR web auth |
| [015](015-getuser-over-getclaims.md) | getUser over getClaims |
| [016](016-swimmer-birth-date-and-public-consent.md) | Swimmer birth dates stored; public display requires explicit consent |
| [017](017-households-replace-guardians.md) | Replace guardians table with household model |
| [019](019-skill-catalog-slugs-and-sync.md) | Permanent slugs and catalog sync for the skills rubric |
| [021](021-lesson-approval-rules.md) | Lesson approval rules |
| [022](022-evaluation-sessions-append-only-ratings-void.md) | Evaluation sessions: append-only ratings with void |
| [023](023-leaderboard-eligibility-and-scoring-rules.md) | Leaderboard eligibility and scoring rules (draft — confirm with Jason) |
| [028](028-parent-booking-emails.md) | Parent booking emails via transactional outbox |
| [029](029-coach-booking.md) | Coach booking on behalf of a family |
| [030](030-parent-batch-booking.md) | Parent multi-lesson batch booking (manual + weekly repeat) |
| [031](031-coach-alerts-web-push.md) | Coach alerts via web push |
