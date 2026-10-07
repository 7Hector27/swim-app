# 007 — Node version pinned with .nvmrc (24)

**Date:** 2026-10-07  
**Status:** Accepted

## Context

CI originally ran on Node 20. `supabase-js` broke on that version, requiring an upgrade. We needed one canonical place to declare the required Node version so CI and local development stay in sync.

## Decision

Pin Node **24** in **`.nvmrc`** at the repo root. CI reads `.nvmrc` to select the Node version; developers run `nvm use` locally.

## Why

- A single file is the source of truth — no divergence between CI config and local setup.
- `.nvmrc` is the standard nvm convention and is recognised by most Node version managers (nvm, fnm, Volta via `package.json` engines, etc.).

## Alternatives considered

- **Hardcode the version in CI only** — local developers may run a different Node version without realising it, reintroducing the class of bug that prompted this decision.
