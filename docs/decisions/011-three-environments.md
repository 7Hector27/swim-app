# 011 — Three environments: local, dev, prod

**Date:** 2026-10-07  
**Status:** Accepted

## Context

The project needs to support active development, pre-production validation of migrations, and a production database containing real family data.

## Decision

Maintain **three environments**:

- **local** — Supabase local stack on each developer's machine; ephemeral, safe to reset.
- **dev** — shared Supabase project; migrations are applied and validated here before touching prod.
- **prod** — live Supabase project; real family data never leaves this environment.

## Why

- Validating migrations on dev before prod prevents schema mistakes from reaching real data.
- Keeping prod data in prod (never copied to dev or local) is the simplest way to protect it.
- The three-tier progression (local → dev → prod) matches the Supabase CLI migration workflow.

## Alternatives considered

- **Two environments (local + prod)** — simpler, but means every migration change goes straight to production without an intermediate validation step.
