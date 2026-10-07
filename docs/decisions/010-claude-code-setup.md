# 010 — Claude Code setup

**Date:** 2026-10-07  
**Status:** Accepted

## Context

We use Claude Code as the primary AI coding assistant. Several built-in and custom capabilities needed explicit decisions about what to enable and what to remove.

## Decision

The project's Claude Code configuration includes:

- **`add-db-table` skill** — scaffolds new Drizzle tables with migrations, shared Zod schemas, and data model docs.
- **`code-reviewer` subagent** — read-only review agent pointed at `CLAUDE.md`; used before opening PRs.
- **`protectEnv` hook** — blocks any tool call that would read `.env` files, preventing accidental secret exposure in context.
- **`typecheckAfterEdit` hook** — runs `tsc --noEmit` scoped to the edited package after every file edit, surfacing type errors immediately.

## Why

- The hooks provide guardrails that apply consistently across all sessions without relying on per-session instructions.
- The skills encode project conventions (schema location, migration workflow) so they don't have to be re-explained each session.

## Alternatives considered

- **Impeccable** — was trialled and removed; it did not fit the project's workflow well enough to justify keeping.
