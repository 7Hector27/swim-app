# CLAUDE.md

## API routes — validation rule

Every new API route **must** validate its request input with a Zod schema from `packages/shared`.

**Pattern:**
1. Define the schema in `packages/shared/src/schemas/<feature>.ts`
2. Export it from `packages/shared/src/index.ts`
3. Apply `validate({ query?, body?, params? })` middleware to the route in `apps/api/src/app.ts`

See `GET /health` (with `HealthQuerySchema`) as the established example.

Routes with no input still apply `validate({})` to make the absence of expected params explicit.
