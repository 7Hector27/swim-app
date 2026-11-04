# Local fault injection (`FAIL_ROUTES`)

A development-only switch on `apps/api` that makes selected routes return
`500 Internal Server Error` before the route handler runs. Use it to exercise
the web app's error / empty-state branches without having to break a route by
hand.

## Usage

Set `FAIL_ROUTES` in `apps/api/.env` (comma-separated patterns):

```env
APP_ENV=local
FAIL_ROUTES=/clubs,/lessons*
```

Restart the API (`pnpm dev`). Matching requests now fail with the standard
error shape:

```json
{ "error": "Internal server error" }
```

Each injected failure logs a `warn` entry tagged with the matching path and
pattern so it's obvious in the API logs why a request failed.

## Patterns

- `/clubs` — exact path match only.
- `/lessons*` — trailing `*` is a prefix match. Matches `/lessons`,
  `/lessons/42`, `/lessons/42/notes`, etc.
- `/lessons/*` — also a prefix match, but requires the separator. Matches
  `/lessons/42` but not `/lessons`.

Patterns are matched against `req.path` (URL without query string).

## Safety: local only

`parseEnv` refuses to boot if `FAIL_ROUTES` is set on any environment other
than `APP_ENV=local`. A deployed server that somehow inherits the var will
fail-fast with an `EnvValidationError` rather than silently returning 500s to
real users. An empty value (`FAIL_ROUTES=`) is treated as unset and is safe in
any environment.
