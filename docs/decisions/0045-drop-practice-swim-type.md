# 0045 — Drop `swimType="practice"` from the API and web

**Date:** 2026-11-20
**Status:** Accepted

## Context

`meetSwims` carries a `swimType` column (enum `meet` | `practice`) and a nullable `meetId`. The original intent was to let coaches record practice-only swims (no meet) alongside meet swims. That flow never reached the UI — no form exposes a practice option, no leaderboard includes practice swims, and the PB query at `apps/api/src/routes/coachSwimmers.ts:557` plus every leaderboard query at `apps/api/src/lib/leaderboard.ts:52` already filters `swimType='meet'`.

The practice branch remained reachable via the API: `CreateMeetSwimBodySchema` allowed `swimType="practice"` with no `meetId`, and the swimmer-detail web action fell back to `swimType="practice"` whenever the (optional) meet picker was blank. That produced orphan rows with no meet context and complicated the entry-form rebuild (which requires a meet).

## Decision

- The `CreateMeetSwimBody` request shape drops `swimType` entirely. `meetId` is now required.
- The API hardcodes `swimType: "meet"` on every new `meetSwims` insert (single and batch routes).
- Web forms, actions, and types no longer reference `"practice"`.
- The Postgres enum and the `meetSwims.swim_type` column are left in place. No migration. Rows with `swim_type='practice'` that already exist in dev stay queryable and keep reading as `SwimType` in responses (the shared enum still includes `"practice"` so the parse boundary doesn't crash on historical data).

## Consequences

- New rows cannot be created without a meet.
- Existing practice rows remain visible wherever `meetSwims` is read; they continue to be excluded from PBs and leaderboards (unchanged behavior).
- If a future flow needs practice swims, it will re-introduce a dedicated writer and the DB enum is still there to receive it — no schema change required.
- Integration tests that fabricate practice rows directly via `db.insert(meetSwims)` still work; only the API refuses them.
