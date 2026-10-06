# 001 — pnpm workspaces monorepo

**Date:** 2025-10-06  
**Status:** Accepted

## Context

The project has a Next.js frontend, an Express API, and shared TypeScript types. We needed a way to develop all three together with a single `dev` command, share code without publishing to npm, and run one install.

## Decision

Use a **pnpm workspaces monorepo** with three packages: `apps/web`, `apps/api`, and `packages/shared`.

- `workspace:*` protocol links local packages without publishing
- `pnpm -r <script>` runs scripts across all packages from the root
- pnpm's content-addressable store deduplicates node_modules across packages
- Strict mode by default prevents phantom dependencies

## Alternatives considered

- **Separate repos** — cross-cutting type changes would require coordinated multi-repo PRs
- **npm/yarn workspaces** — pnpm is faster, uses less disk, and enforces stricter dependency isolation

## Consequences

- All contributors need pnpm ≥ 9
- CI installs with `--frozen-lockfile` to catch uncommitted lockfile changes
- Adding a new package means adding it to `pnpm-workspace.yaml`
