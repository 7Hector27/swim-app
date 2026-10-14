# 011 — Session undo window and coach categories endpoint

**Date:** 2026-10-14  
**Status:** Accepted

## Context

The E-4 evaluation screen lets coaches rate swimmers poolside and save the result as an evaluation session. Two design decisions needed to be made explicit:

1. **How long can a coach undo a submission?** Coaches occasionally tap "Save" too early or realize a mistake immediately after saving. A short undo window avoids the heavier process of voiding individual ratings.

2. **Where does the skills catalog live for the web client?** The evaluate page needs to render skill fields grouped by category. The catalog is already in the database; the question was whether to embed it at build time or fetch it at runtime.

## Decision

### Undo window — whole-session delete within 10 minutes

A `DELETE /coach/sessions/:id` endpoint deletes the session and all its ratings atomically (in a single transaction) within a 10-minute window. After 10 minutes the endpoint returns 409 and the coach must use the per-rating void action instead.

The web client shows an undo toast on the success screen. The toast disappears when the window expires (`savedAt + 10 min`). The delete is a single network request; it does not delete ratings individually.

The 10-minute constant (`UNDO_WINDOW_MS = 10 * 60 * 1000`) is defined once at the module level in `apps/api/src/routes/evaluations.ts`.

### Coach categories endpoint — runtime fetch, coach-only

`GET /coach/categories` returns all non-archived skill categories with their skills. It is guarded by `requireUser` + `requireCoach` and is fetched at page-load time by the evaluate page and the swimmer detail page. It is not embedded at build time because the catalog changes when skills are added or archived, and a stale build would show outdated fields.

The response schema (`CategoriesResponseSchema`) lives in `packages/shared` and is validated on the client with `safeParse` before rendering.

## Why

- **10 minutes** is long enough for a coach to catch a tap error while still at the pool deck, but short enough that sessions are effectively immutable after the session is over. The void action remains available indefinitely for corrections found later.
- **Whole-session delete** keeps the undo path simple (one request, no partial state) and avoids the need to track which ratings to roll back individually.
- **Runtime catalog fetch** means coaches always see the current skill list without needing a redeploy when the catalog changes.
- **Coach-only guard** on `/coach/categories` keeps catalog data off parent-facing routes, consistent with the role model in `docs/accounts.md`.
