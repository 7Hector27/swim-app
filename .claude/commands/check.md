---
description: Run all checks in order and report results. Never fixes anything.
argument-hint: "[quick]"
---

Run these checks from the repo root, in this order, one at a time:

1. pnpm typecheck
2. pnpm lint
3. pnpm test
4. pnpm test:integration
5. `rm -rf apps/web/.next && pnpm --filter web build` (on Windows PowerShell: `Remove-Item -Recurse -Force apps/web/.next -ErrorAction SilentlyContinue; pnpm --filter web build`)

Step 5 wipes `apps/web/.next` before building because a stale incremental cache from an earlier interleaved run (integration tests before build, build after a partial run, etc.) has caused `/_not-found` and `Cannot find module './vendor-chunks/...'` prerender errors that disappear on a clean rebuild. Always start from an empty `.next` so a build failure in this step is a real failure.

If $ARGUMENTS is "quick", skip step 4.

Before step 4, check that the **test** Supabase stack is running (not the manual one). Integration tests only run against the test stack per ADR 035. Quick check: `pnpm db:test:status` should list running services on ports 54421 / 54422, not report every container stopped. If it isn't up, stop and tell me to run `pnpm db:test:up`. Don't start it yourself.

**Always capture step 4 (and only step 4) to a log file** so a failure never needs a rerun to see what broke. Before running step 4:

- `mkdir -p .check-output`
- Run: `pnpm test:integration 2>&1 | tee .check-output/integration.log` (or the PowerShell equivalent on Windows — pipe the command through `Tee-Object -FilePath .check-output/integration.log`).

The `.check-output/` directory is already gitignored, so the log never leaks into commits.

If step 4 fails, read `.check-output/integration.log` directly to extract:

- Every `FAIL` line and the test name it names.
- Every `×` / `✗` failed-test line.
- The first `Error:` / `AssertionError:` block per failed test with the file path + line number.

Report those failing tests in the output — do NOT rerun step 4 to re-collect names.

Stop at the first failure. Don't fix anything, don't edit files, don't commit, don't push.

Report back in this format:

- A table: step, pass/fail/skipped, how long it took.
- For a failure: the first few errors with file:line, and one line on the likely cause. For step 4, list every failing test name (from the log file, not from memory).
- If everything passed, just say "All checks passed" with the table.
