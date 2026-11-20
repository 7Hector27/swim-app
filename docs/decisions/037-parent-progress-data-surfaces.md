# 037 — Parent progress data surfaces: parent-safe categories, coach first name, and golf-score trends

**Date:** 2026-11-19
**Status:** Accepted

## Context

The rebuilt parent progress page at `/dashboard/swimmers/[id]/progress` added or reshaped three API surfaces that touch kids' data and coach identity. Each is small on its own, but together they're the first time the parent app sees a derived subset of catalog + priority + cohort data, and the privacy and shape decisions deserve to be on record alongside ADR 032 (parent/coach serialization boundary) and `docs/accounts.md` (roles and kids'-data rules).

The three surfaces this ADR covers:

1. A **parent-safe skills catalog endpoint**, mounted at `/parent/categories`, that the parent page needs for group / stroke labels and for descriptor lookups.
2. A **coach first name** field on the latest-coaching-priority payload the parent receives, so the "From Coach Jason · Nov 17" byline can render without the UI having to guess or look up the coach.
3. A **parent golf-score trends** endpoint, mounted at `GET /swimmers/:id/golf-score`, backed by a shared compute library the coach route (`/coach/swimmers/:id/golf-score-trends`) also uses.

## Decision

### Parent-safe catalog at `/parent/categories`

A new `parentCatalog` router mounts `GET /parent/categories`. It returns the same category + skill tree the coach catalog returns (names, slugs, grouping, descriptors) and strips nothing structural — descriptors are already copy the coach wrote with parents in mind. The route runs `requireUser` → `requireParent`; nothing else is needed because the catalog is reference data with no per-swimmer rows. It returns a `ParentCategoriesResponse` parsed through a strict Zod schema so a future coach-only field (e.g. per-skill coach notes, fault tag definitions) cannot accidentally reach parents.

The parent page needs this because:

- The coach catalog route (`/categories`) is behind `requireCoach` by design.
- The parent progress response (`/swimmers/:id/progress`) carries per-swimmer rows, not the full catalog — the "Working on next" cards need display names, groupings, and category labels for every priority slug the server returns, not just the ones the swimmer has been rated on.
- Rolling the catalog into the progress response would double its size on every poll for data that changes rarely. A separate catalog endpoint lets the web app cache it independently.

Alternatives considered:

- **Serving the coach catalog to parents.** Rejected. The coach schema isn't `.strict()`, so a future coach-only field would silently leak through. The parent-side strict schema is the audit trail that stops that.
- **Inlining the catalog into the progress response.** Rejected. See above — wrong cadence and wrong caching boundary.

### Coach first name on the parent priority payload

`LatestCoachingPriority.coachFirstName: string | null` on `ParentSwimmerProgressResponse`. The field is derived server-side in `apps/api/src/routes/parentProgress.ts` from the first whitespace-separated token of `profiles.full_name` via a `leftJoin` on the session's coach. The full name is pulled into the query but trimmed in the route before the payload is built — the coach's last name and every other field on `profiles` never leave the API through this route.

`docs/accounts.md` now explicitly states parents see only the first name on this payload, and "coach's last name, email, phone, role, and any other `profiles` field beyond `coachFirstName`" is on the never-exposed list.

The field is `null` when:

- The coach's profile has no `full_name` on record, or
- The latest priority row has no coach profile (legacy data).

The parent client falls back to "From your coach" copy in that case.

Alternatives considered:

- **Shipping the full name and trimming on the client.** Rejected. Writing the trim on the API side means the last name is never serialized to a parent response — the UI can't leak what it doesn't have, even if the byline helper changes.
- **Returning a coach id and looking the name up separately.** Rejected. Parents can't resolve a profile id without another API hop that would need a dedicated parent-facing profile route, carrying the same leak risk. Shipping the derived first name directly keeps the surface area minimal.

### Parent golf-score trends at `GET /swimmers/:id/golf-score`

A parent-facing golf-score endpoint, gated by `requireUser` → `requireParent` → `requireHouseholdMember` → `requireHouseholdSwimmer`. Returns `ParentGolfScoreTrendsResponse`: per-stroke + per-category trend points plus the age-group band the coach route also serves.

Compute lives in `apps/api/src/lib/golfScoreTrends.ts` and is shared with the coach route. The function takes an `audience: "coach" | "parent"` option — TypeScript overloads narrow the return type to `ParentGolfScoreTrend[]` on `audience: "parent"`. The parent shape omits `sessionId` on every point, because:

- Parents cannot reach the per-session edit affordance that the coach route's deep-link uses (ADR 032).
- Shipping an id a client can't resolve widens the attack surface for no gain.

`sessionId` is dropped at **build time**, not stripped at the route boundary. The library's point builder spreads the field conditionally based on `audience`, so a caller that forgets to pass `audience: "parent"` would get the coach shape — a loud TypeScript mismatch, not a silent leak. `ParentGolfScoreTrendsResponseSchema.strict()` runs as a parse-time safety net on top.

The cohort query that drives the age band runs **once per request** across every `(skillSlug, category)` pair the swimmer has rated — not once per pair in a loop. See the per-category loop in the same file for the N+1 fix that pulled the query above the loop and buckets results by `${slug}::${category}` key.

Alternatives considered:

- **Folding parent + coach into one route with a role-switched response shape.** Rejected. Two routes with separate strict schemas is the pattern ADR 032 established; parents and coaches have distinct auth chains and the audit trail is cleaner with distinct responses.
- **Keeping the sessionId strip at the route boundary.** Rejected (now). An earlier version did exactly this and relied on `.strict()` to catch the leak at parse time. The library-level audience switch means the field is never built for parents at all — defense in depth without relying on a runtime parse to catch a developer mistake.

### Follow-ups left for later

The cohort age-group filter on `golfScoreTrends.ts:105–118` still loads every active swimmer's birth date and filters to the age group in JS. For today's roster size that's a non-issue; once the club grows the filter should move into SQL so the pull-set stays small. This is a performance note, not a privacy issue.
