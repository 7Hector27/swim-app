---
description: Run all checks in order and report results. Never fixes anything.
argument-hint: "[quick]"
---

Run these checks from the repo root, in this order, one at a time:

1. pnpm typecheck
2. pnpm lint
3. pnpm test
4. pnpm test:integration
5. pnpm --filter web build

If $ARGUMENTS is "quick", skip step 4.

Before step 4, check that local Supabase is running. If it isn't, stop and tell me to start it. Don't start it yourself.

Stop at the first failure. Don't fix anything, don't edit files, don't commit, don't push.

Report back in this format:

- A table: step, pass/fail/skipped, how long it took.
- For a failure: the first few errors with file:line, and one line on the likely cause.
- If everything passed, just say "All checks passed" with the table.
