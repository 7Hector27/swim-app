# Accounts, roles, and permissions

## Roles

| Role         | Who                              | How they get it                                        |
| ------------ | -------------------------------- | ------------------------------------------------------ |
| coach        | Jason                            | Normal signup, then one SQL update. No UI can grant it |
| parent       | Parents and adult swimmers (18+) | Public signup after the age check (default role)       |
| teen (later) | Swimmers 13 to 17                | Parent invite only                                     |

No role: public visitors, and kids under 13 (no accounts ever).

## Rules

- The role never comes from signup data. The database sets every new profile to parent.
- Users can change only their own name and phone.
- The API blocks accounts with no `age_attested_at` or with `disabled_at` set.
- Birth dates from signup are checked, then discarded.
- The API enforces every permission. Every table has RLS on with no policies, which denies all access on purpose: the browser's public key can't read anything, and the API connects as the database owner.
- The app role is read from the database on every request, never from the JWT.
- Tokens are verified against Supabase's auth server on every request via `getUser`, not decoded locally. Revoked sessions and banned users are rejected immediately rather than being allowed until the JWT's `exp` claim expires.
- **Every signup path must pass `emailRedirectTo`** when calling Supabase's signup API. The confirmation email template (`supabase/templates/confirmation.html`) builds the confirmation link as `{{ .RedirectTo }}&token_hash=…` with no fallback — if `emailRedirectTo` is omitted, `.RedirectTo` is empty and the link is broken. Normal signup sets it to `/auth/confirm?`; invite signup sets it to `/auth/confirm?returnTo=<encoded>`.

## Households

Every parent profile belongs to exactly one household. Signup automatically creates a household named `"[last word of fullName] household"` and adds the new profile as its `owner`.

### Household roles

| Role    | Who                                 | Permissions                                                       |
| ------- | ----------------------------------- | ----------------------------------------------------------------- |
| owner   | The profile that created the account | Full control: manage swimmers, set `is_public` to `true` or `false`, manage household membership |
| manager | Additional trusted adults            | Manage swimmers, set `is_public` to `false`; cannot set `is_public` to `true` |
| viewer  | Read-only household members          | View swimmers and set `is_public` to `false`; cannot set `is_public` to `true` or edit swimmer data |

### Member management rules

- **Rename** (`PATCH /households/mine`): owner only. Name 1–50 characters.
- **Change role** (`PATCH /households/mine/members/:profileId`): owner only. Target role must be `manager` or `viewer`; `owner` is set only via transfer. Owner cannot change their own role this way.
- **Remove member** (`DELETE /households/mine/members/:profileId`): owner only. Cannot remove themselves. The removed member is atomically placed in a new solo household (named from their last name) as its owner.
- **Leave** (`DELETE /households/mine/members/me`): any non-owner member. Owner must transfer ownership first (409 `must_transfer_first`). The leaver is atomically placed in a new solo household as its owner.
- **Transfer ownership** (`POST /households/mine/transfer-ownership`): owner only. Target must be an existing member. The transaction demotes the current owner to manager before promoting the target, so the `UNIQUE (householdId) WHERE role='owner'` constraint is never violated. Cannot transfer to self.
- **Generate invite** (`POST /households/mine/invites`): owner only.
- **List pending invite** (`GET /households/mine/invites`): owner only. Returns metadata only (id, expiresAt, createdAt) — the raw token is a one-time value returned only at generation time and never stored.
- **Revoke invite** (`DELETE /households/mine/invites/:id`): owner only.

All write actions produce an audit log entry.

### Middleware

- `requireHouseholdMember` — looks up the caller's `household_members` row; attaches `req.householdId` and `req.householdRole`; returns 403 if no row exists.
- `requireHouseholdRole(min)` — synchronous check that `req.householdRole` is at least `min` in the `owner > manager > viewer` hierarchy; returns 403 on failure.
- `requireHouseholdSwimmer` — verifies the swimmer in `/:id` belongs to `req.householdId` and is not archived; returns 404 on failure.

## Who sees what

| Data                              | Coach        | Parent (household member)       | Public                            |
| --------------------------------- | ------------ | ------------------------------- | --------------------------------- |
| Swimmer list (roster)             | All active swimmers | Only their own household's swimmers | No |
| Swimmer detail + member contact   | All swimmers | Only their own household's swimmers | No |
| Swimmer ratings, times, progress  | All swimmers | Only their own household's swimmers | Opted-in swimmers, limited fields |
| Coaching priority (per evaluation) | Yes         | Yes — visible by design (see note below) | No                          |
| Coach notes                       | Yes          | No                              | No                                |
| Rating notes (per-skill free-text) | Yes         | No                              | No                                |
| Fault tags                        | Yes          | No                              | No                                |
| Void reasons                      | Yes          | No                              | No                                |
| Edit ratings, times, notes        | Yes          | No                              | No                                |
| Set is_public to true             | No           | Household owner only            | No                                |
| Set is_public to false            | Yes          | Any household member            | No                                |

**Coaching priority (per evaluation):** Visible to parents by design — this is the focus the coach sets for that session, intended for parent awareness. Pending confirmation from Jason.

The following fields remain coach-only:
- **Rating notes** (per-skill free-text): never shown to parents.
- **Fault tags**: never shown to parents.
- **Void reasons**: never shown to parents.

## Coach permissions

Coaches access swimmer data through dedicated `/coach/swimmers` routes protected by `requireCoach` middleware. These routes:

- Return all active (non-archived) swimmers, not filtered by household membership
- Include household member contact info (fullName + phone only) on the detail route — never birth dates, emails, or notes
- Allow setting `isPublic` to `false` on any swimmer; setting it to `true` is always a household-owner-only action
- Never expose `publicConsentBy` or `publicConsentAt` fields to the response
- The roster list (`GET /coach/swimmers`) includes `memberNames` (full names of household members) per swimmer — no contact details. This is intentional: the coach needs to know which family a swimmer belongs to.
- The swimmer detail (`GET /coach/swimmers/:id`) includes the household's active home pool address. The coach needs the address because lessons take place there. This address is returned only in the per-household context of a single swimmer lookup — never in a flat list of all locations. The coach cannot edit a household's home pool address; that is managed exclusively by the household owner.
- **Home pool addresses are not pushed to Google Calendar.** The Google Calendar sync (ADR 027) sends an event's `location` field to a third-party data processor. For lesson locations with a non-null `household_id` (home pools) that would mean putting a specific family's residential address outside the app's data boundary. Pending Jason's input and the kids'-data legal review on whether written parent consent would permit this, the sync omits the street + zip and sends only `"<name> — <city>, <state>"` for home-pool events. Named pools (public venues) send the full address. Revisit after the legal review resolves.
- **Swimmer first names appear in Google Calendar event titles.** The event's `summary` is `"Swim lesson: <first>"` or `"Swim lesson: <first> & <first>"` so the coach can tell lessons apart at a glance in their calendar. Last names, birth dates, and swimmer ids are never sent. First names alone are the minimum required for the display, but even that is a third-party disclosure of information about minors. Covered by the same Jason-input + kids'-data legal review as the home-pool address decision above. Revisit alongside it. If the review requires names to be removed, the summary falls back to generic `"Swim lesson"` with the roster visible only inside the app via the event description's link back to the lesson detail.
- `GET /lessons/available-slots` is accessible to coach tokens (it sits behind `requireUser`, not `requireParent`). Coaches can query availability for any location. This is intentional — the endpoint is read-only and contains no household-private data — and it will be needed when the coach scheduling UI is built.

## Kids' data

- **Birth dates are stored** for swimmers. This differs from the age check at parent signup (where the birth date is verified and then discarded). Swimmer birth dates are required permanently to calculate age groups for competition. See ADR 016.
- **Tracking is always on.** Every swimmer in the system is tracked (times, assessments, progress). There is no opt-out from tracking itself.
- **`is_public` controls public display only.** A swimmer with `is_public = false` is tracked normally but never appears on public leaderboards or pages. Setting `is_public = true` requires explicit consent from the household owner recorded in `public_consent_at` and `public_consent_by`.
- **Only the household owner can set `is_public` to `true`.** The server verifies the authenticated caller is the `owner` of the household that owns the swimmer, then records their profile ID as `public_consent_by` and the current timestamp as `public_consent_at`. The client never supplies these fields. Coaches cannot set `is_public` to `true`.
- **Any household member or the coach can set `is_public` to `false`.** No consent re-check is needed to opt out.
- **Turning `is_public` off keeps the last consent fields as an audit trail.** `public_consent_at` and `public_consent_by` are not cleared when `is_public` is set back to `false`. Turning it back on records new consent by overwriting both fields with the current timestamp and caller. Re-sending `is_public: true` when the swimmer is already public does **not** refresh the consent fields — the existing `public_consent_at` and `public_consent_by` are preserved.
- **Swimmers are soft-deleted via `archived_at`.** Setting `archived_at` to a non-null timestamp hides the swimmer from active views. The row and all associated data are retained.
- **Every swimmer query must exclude archived rows.** All queries against the `swimmers` table must include `WHERE archived_at IS NULL` (Drizzle: `.where(isNull(swimmers.archivedAt))`). There is no DB-level filter enforcing this automatically — it is a required convention for every route.
- **Profiles are never hard-deleted.** Profiles referenced by swimmers or consent records must remain as rows. Closing an account disables the profile (`disabled_at`) and scrubs its personal fields; the full account deletion flow is out of scope for now.
- **Clubs are never deleted, only deactivated.** Setting `is_active = false` on a `clubs` row hides it from new registrations but preserves all existing `swimmer_clubs` references. Hard-deleting a club is blocked by the `ON DELETE RESTRICT` FK on `swimmer_clubs.club_id`.
- Public pages show opted-in swimmers only, as first name and last initial. Never birth date, contact info, or school.
- Never log names, birth dates, emails, or notes.
