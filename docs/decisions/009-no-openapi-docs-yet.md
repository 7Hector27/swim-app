# 009 — No OpenAPI docs yet

**Date:** 2026-10-07  
**Status:** Accepted

## Context

The API has multiple routes with request/response schemas. OpenAPI documentation is common for APIs, but documentation has a maintenance cost and is most valuable when there are external consumers.

## Decision

**Do not generate or maintain OpenAPI docs for now.** The only API consumer is our own web app, and shared Zod schemas in `packages/shared` keep both sides in sync with compile-time safety.

## Why

- Shared Zod schemas are the contract layer — they enforce correctness at compile time, which is stronger than documentation.
- OpenAPI docs would need to stay in sync with the schemas manually or via additional tooling, adding overhead with no current benefit.

## Alternatives considered

- **Generate OpenAPI from Zod schemas (e.g. zod-to-openapi)** — revisit this when building an MCP server or any external API consumer; at that point, a machine-readable spec becomes genuinely useful.
