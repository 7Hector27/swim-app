# 008 — No git hooks (lefthook removed), CI is the gate

**Date:** 2026-10-07  
**Status:** Accepted

## Context

We previously had lefthook running checks on pre-push. Claude Code hooks were introduced to run typecheck during editing sessions.

## Decision

**Remove lefthook.** CI is the authoritative quality gate. Claude Code's `typecheckAfterEdit` hook catches type errors during active editing without blocking commits or pushes.

## Why

- Pre-push hooks add friction for fast iteration and feel like overkill given CI runs on every push anyway.
- Claude Code hooks give real-time feedback during editing, which is where errors are cheapest to fix.
- Fewer moving parts locally reduces onboarding complexity.

## Alternatives considered

- **Keep lefthook** — provides a local gate that catches issues before CI, but duplicates checks already enforced there and slows the push workflow.
