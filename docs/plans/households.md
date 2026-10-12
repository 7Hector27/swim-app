# Households: three-PR plan

**Status:** Draft — 2026-10-11

## Context

The current system links parents to swimmers directly through the `guardians` table (`profile_id → swimmer_id`). It has no concept of a family group, shared management, or permission tiers within a family.

These three PRs replace `guardians` with a household model: every parent belongs to exactly one household, every swimmer belongs to exactly one household (enforced by a `household_id` column on the `swimmers` table), and household members carry a role (owner / manager / viewer) that governs what they can do.

User role (`coach` / `parent`) and household role are separate. User role controls access to coach features. Household role controls what a parent can do within their family.

**No production data exists.** All backfill migration logic is designed for local dev databases only.

---

## PR 1 — Households and roles

Introduces the schema, wires signup to auto-create a household, backfills existing data from `guardians` and drops that table, swaps permission checks on all swimmer routes to use household membership, adds the audit log, and updates docs.

### Schema changes

**New enum**

```
household_role: owner | manager | viewer
```

**New tables**

`households`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | default random |
| `name` | text not null | set at signup; owner can rename |
| `created_at` | timestamptz not null | default now |
| `updated_at` | timestamptz not null | default now |

`household_members`
| Column | Type | Notes |
|---|---|---|
| `household_id` | uuid not null | → households.id on delete cascade |
| `profile_id` | uuid not null | → profiles.id on delete restrict |
| `role` | household_role not null | |
| `joined_at` | timestamptz not null | default now |
| PK | (household_id, profile_id) | |
| Unique index | profile_id | enforces one household per person |

`household_audit_log`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | default random |
| `household_id` | uuid not null | → households.id on delete cascade |
| `actor_id` | uuid not null | → profiles.id on delete restrict |
| `action` | text not null | e.g. `member_added`, `member_removed`, `role_changed`, `swimmer_added`, `swimmer_removed`, `ownership_transferred`, `household_renamed` |
| `target_profile_id` | uuid nullable | → profiles.id on delete restrict |
| `target_swimmer_id` | uuid nullable | → swimmers.id on delete restrict |
| `new_role` | household_role nullable | populated for role changes |
| `created_at` | timestamptz not null | default now |

No personal data is written to this table — only UUIDs, action strings, and timestamps.

**Modified table**

`swimmers` — add column:
| Column | Type | Notes |
|---|---|---|
| `household_id` | uuid not null | → households.id on delete restrict |

One household per swimmer is enforced by the `NOT NULL` constraint and the fact that the column is a single scalar FK (not a join table).

**Dropped table**

`guardians` — dropped after the backfill migration.

**Backfill migration** (runs in a single migration after the structural `CREATE TABLE` migration)

1. Assert no swimmer has more than one guardian. If any do, raise an error: `"Found N swimmer(s) with multiple guardians. Reset your local DB: pnpm db:down && pnpm db:up && pnpm db:migrate"`. No production data exists, so this edge case is only possible in unusual local dev setups.
2. For each distinct `profile_id` in `guardians`, create a household named `"[last word of profiles.full_name] household"` (fallback: `"My household"` when `full_name` is null or blank).
3. Insert that profile as `owner` of the new household.
4. `UPDATE swimmers SET household_id = <new_household_id> WHERE id IN (SELECT swimmer_id FROM guardians WHERE profile_id = ?)`.
5. Write one `swimmer_added` audit log row per swimmer moved (actor = owner).
6. Assert row count: every swimmer must have a non-null `household_id` after the loop.
7. `ALTER TABLE swimmers ALTER COLUMN household_id SET NOT NULL`.
8. `DROP TABLE guardians`.

### Files touched

```
apps/api/src/db/schema.ts
apps/api/src/db/migrations/<ts>_add_households.sql         CREATE TABLE + ADD COLUMN nullable + FK
apps/api/src/db/migrations/<ts>_backfill_households.sql    backfill + SET NOT NULL + DROP guardians
apps/api/src/db/queries.ts                                  add household / member / audit helpers
apps/api/src/types/express.d.ts                             add householdId + householdRole to Request
apps/api/src/app.ts                                         signup: create household after profile row update
apps/api/src/middleware/requireHouseholdMember.ts           new — fetches membership, attaches householdId + householdRole to req
apps/api/src/middleware/requireHouseholdSwimmer.ts          new — verifies req.params.id swimmer belongs to req.householdId
apps/api/src/middleware/requireGuardian.ts                  deleted
apps/api/src/routes/swimmers.ts                             replace guardians / requireGuardian with household checks
apps/api/src/routes/coachSwimmers.ts                        replace guardians query with household_members query
apps/api/src/routes/households.ts                           new — GET /households/mine
packages/shared/src/schemas/households.ts                   new — HouseholdRole, HouseholdMember, HouseholdResponse
packages/shared/src/schemas/swimmer.ts                      rename guardianNames → memberNames, guardians → members
packages/shared/src/index.ts                                export new schemas
apps/web/src/content/CoachDashboardContent/SwimmersTable.tsx   field rename
apps/web/src/content/CoachSwimmerDetailContent/CoachSwimmerDetailContent.tsx  field rename
docs/accounts.md                                            replace guardian language; add household-role table
docs/decisions/017-households-replace-guardians.md          ADR
apps/api/src/__tests__/swimmers.test.ts                     update mocks for household model
apps/api/src/__tests__/coachSwimmers.test.ts                update renamed fields
apps/api/src/__tests__/integration/helpers.ts               update cleanup (no guardians; delete audit log + swimmers + members + household before user)
apps/api/src/__tests__/integration/swimmers.integration.test.ts   update for new schema
apps/api/src/__tests__/integration/households.integration.test.ts  new
```

### Routes

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | /households/mine | requireUser + requireParent + requireHouseholdMember | Returns household id, name, caller's role, member list (profileId, role, fullName, joinedAt), and active swimmer IDs |

All existing `/swimmers` routes keep their paths. Only the internal permission check changes.

### Permission rules

| Action | Owner | Manager | Viewer | Coach |
|---|---|---|---|---|
| Read household's swimmers | ✓ | ✓ | ✓ | ✓ via coach routes |
| Create swimmer | ✓ | ✓ | — | — |
| Edit swimmer fields | ✓ | ✓ | — | ✓ |
| Archive swimmer (`archived_at`) | ✓ | — | — | — |
| Set `is_public` to true | ✓ | — | — | — |
| Set `is_public` to false | ✓ | ✓ | ✓ | ✓ |

`requireHouseholdMember` fetches the caller's `household_members` row and attaches `req.householdId` and `req.householdRole`. Returns 403 if no membership exists.

`requireHouseholdRole(minimumRole)` checks `req.householdRole` against the minimum (owner > manager > viewer). Returns 403 if insufficient.

`requireHouseholdSwimmer` checks that `swimmers.household_id = req.householdId` for `req.params.id`. Returns 404 if not found or not in household.

Note: setting `is_public` to `true` was previously open to any guardian. It is now restricted to the household owner only. This is a tightening of the existing rule.

### Tests

- Signup creates a household named `"[last word of fullName] household"` and adds the user as owner.
- Signup with a single-word `fullName` uses that word as the household name.
- `GET /households/mine` returns correct household id, name, myRole, member list, and swimmer IDs.
- `GET /households/mine` returns 403 when the caller has no household row (safety net).
- `GET /swimmers/me` returns only the caller's household's swimmers.
- `GET /swimmers/:id` returns 404 for a swimmer in another household.
- Owner can create and edit swimmers.
- Viewer cannot create swimmers (403), cannot edit swimmers (403), cannot archive (403).
- Manager can create and edit but not archive (403).
- Owner can set `is_public` to true; manager and viewer receive 403.
- Any member can set `is_public` to false.
- Non-member (different household) cannot read or write another household's swimmers (404).
- `DELETE /swimmers/:id` (archive) requires owner; manager gets 403.
- Audit log row is written when a swimmer is created.
- Integration: POST /swimmers creates swimmer with correct household_id; no guardians row exists.
- Integration: parent isolation — Parent B cannot access Parent A's swimmer (404).
- Integration: GET /households/mine returns the correct household created at signup.

### Out of scope

- Invite system (PR 2).
- Member management UI, remove/leave/transfer/rename (PR 3).
- Household API routes beyond `GET /households/mine`.
- Coach admin overrides of household permissions.
- One person in multiple households.
- Household deletion.

---

## PR 2 — Invites

Adds the invite token table, the generate/revoke/accept API, and the web accept screen. Handles the sign-up-and-return redirect flow for unauthenticated users. Blocks joining if the invitee's own household already has swimmers.

### Schema changes

**New table**

`household_invites`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | default random |
| `household_id` | uuid not null | → households.id on delete cascade |
| `token_hash` | text not null unique | SHA-256 of the raw token; raw token never stored |
| `created_by` | uuid not null | → profiles.id on delete restrict |
| `expires_at` | timestamptz not null | always `created_at + 72 hours`; set by the server, never by the client |
| `revoked_at` | timestamptz nullable | |
| `accepted_at` | timestamptz nullable | |
| `accepted_by` | uuid nullable | → profiles.id on delete restrict |
| `created_at` | timestamptz not null | default now |

Check constraint: `revoked_at` and `accepted_at` cannot both be non-null.

### Files touched

```
apps/api/src/db/schema.ts
apps/api/src/db/migrations/<ts>_add_household_invites.sql
apps/api/src/db/queries.ts                                  add invite helpers (insert, find-by-hash, revoke, accept)
apps/api/src/routes/households.ts                           POST /households/mine/invites, DELETE /households/mine/invites/:id
apps/api/src/routes/invites.ts                              new — GET /invites/:token, POST /invites/:token/accept
apps/api/src/app.ts                                         mount invitesRouter
packages/shared/src/schemas/invites.ts                      new — InviteStatusResponse, GenerateInviteResponse
packages/shared/src/index.ts                                export new schemas
apps/web/src/app/invite/[token]/page.tsx                    new — accept screen entry point
apps/web/src/content/InviteContent/InviteContent.tsx        new — accept screen body
apps/web/src/content/InviteContent/index.ts                 new
docs/decisions/018-invite-tokens-stored-as-hashes.md        ADR
```

### Routes

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | /households/mine/invites | requireUser | Owner only. Generates a single-use invite; returns `{ id, url }`. Raw token included once in the URL fragment and never stored. |
| DELETE | /households/mine/invites/:id | requireUser | Owner only. Revokes a pending invite. Returns 404 if already accepted or not found. |
| GET | /invites/:token | public | Returns household name and invite status: `pending`, `expired`, `revoked`, or `accepted`. Never returns who created it. |
| POST | /invites/:token/accept | requireUser | Accepts the invite. Adds the caller as `viewer`. Returns 409 if the caller's household has swimmers. |

### Accept screen flow

1. User opens `/invite/[token]`.
2. The page calls `GET /invites/:token` to check status and fetch the household name.
3. If the invite is expired, revoked, or already accepted: render an inert error state with no action available.
4. If the user is not signed in: redirect to `/sign-up?returnTo=/invite/[token]` (or `/log-in?returnTo=...`). After auth, the `returnTo` param lands them back on the accept screen. The Next.js sign-up and log-in flows must already honor `returnTo`; if they don't, that wiring is part of this PR.
5. If the user is signed in and the invite is pending: show "Join the [name] household?" with a confirm button.
6. On confirm: call `POST /invites/:token/accept`.
7. If the response is 409 (swimmer conflict): show "Your household already has swimmers in it. You can't join another household while it does."
8. On success: redirect to the dashboard.

### Permission rules

- Generate and revoke: owner only (`requireHouseholdRole("owner")`).
- `GET /invites/:token`: public. Returns only household name and status — nothing that identifies who owns the household.
- `POST /invites/:token/accept`: requires `requireUser`. Additional server-side checks:
  - Token must be `pending` (not expired, revoked, or already accepted).
  - Caller must not already be a member of this household.
  - Caller's own household must have zero swimmers (i.e., `SELECT COUNT(*) FROM swimmers WHERE household_id = caller's household_id` = 0).
- New members always join as `viewer`.
- Audit log: `member_added` entry on accept, with `target_profile_id = accepted_by`.

### Tests

- `POST /households/mine/invites` returns a URL; the raw token is not present in the database.
- Non-owner calling `POST /households/mine/invites` returns 403.
- `GET /invites/:token` returns `pending` for a fresh invite.
- `GET /invites/:token` returns `expired` after 72 hours (test with a backdated `expires_at`).
- `GET /invites/:token` returns `revoked` after the owner calls `DELETE /households/mine/invites/:id`.
- `GET /invites/:token` returns `accepted` after the invite is used.
- `POST /invites/:token/accept` adds the caller as `viewer` and marks the invite as accepted.
- Accepting an already-accepted invite returns 409.
- Accepting an expired invite returns 409.
- Accepting a revoked invite returns 409.
- Accepting returns 409 when the caller's household already has swimmers.
- Caller who is already a member of the household cannot accept (409).
- Accept writes a `member_added` audit log entry.
- Accept screen: unauthenticated user is redirected to sign-up with the correct `returnTo`; after auth they land back on the accept screen with the invite still pending.
- Accept screen: shows correct error state for each non-pending status.
- Accept screen: shows the household name in the confirmation prompt.
- Accept screen: swimmer-conflict error message is displayed on 409.

### Out of scope

- Email-based or SMS-based invites. The invite is a raw link only.
- Invite list visible to the owner before PR 3 ships (the owner can generate and share links but has no UI to see or revoke pending invites until the member management screen in PR 3).
- Multiple simultaneous pending invites per household are permitted; the owner can generate more than one.
- Member management UI (PR 3).
- Coach admin overrides.

---

## PR 3 — Member management UI

Adds the web UI for managing household membership. Adds the remaining API routes for renaming, role changes, removal, leave, and ownership transfer. All of these operations are performed from a household settings page. The invite list and revoke action also live here.

### Schema changes

None. All tables were introduced in PRs 1 and 2.

### Files touched

```
apps/api/src/routes/households.ts          PATCH /households/mine
                                            PATCH /households/mine/members/:profileId
                                            DELETE /households/mine/members/:profileId
                                            DELETE /households/mine/members/me
                                            POST /households/mine/transfer-ownership
                                            GET /households/mine/invites
packages/shared/src/schemas/households.ts  add RenameHouseholdBody, PatchMemberBody,
                                            TransferOwnershipBody, InviteListResponse
packages/shared/src/index.ts               export new schemas
apps/web/src/app/household/page.tsx                        new — settings page entry
apps/web/src/content/HouseholdContent/HouseholdContent.tsx new — page body
apps/web/src/content/HouseholdContent/MemberList.tsx       new — member rows with role badge + actions
apps/web/src/content/HouseholdContent/PendingInvites.tsx   new — list pending invites, generate + revoke
apps/web/src/content/HouseholdContent/index.ts             new
apps/web/src/app/(auth-layout)/layout.tsx or nav           add "Household" link for owner and manager
docs/accounts.md                                           add member management and ownership-transfer rules
```

### Routes

| Method | Path | Auth | Description |
|---|---|---|---|
| PATCH | /households/mine | requireUser | Owner only. Rename the household. Body: `{ name: string }`. Name is trimmed and must be 1–100 characters. |
| PATCH | /households/mine/members/:profileId | requireUser | Owner only. Change a member's role to `manager` or `viewer`. Owner cannot change their own role this way. |
| DELETE | /households/mine/members/:profileId | requireUser | Owner only. Remove another member. Owner cannot remove themselves. |
| DELETE | /households/mine/members/me | requireUser | Any non-owner member. Leave the household. Owner receives 403 with message to transfer first. |
| POST | /households/mine/transfer-ownership | requireUser | Owner only. Body: `{ profileId: string }`. Target must be an existing member. After transfer, caller becomes `manager`. |
| GET | /households/mine/invites | requireUser | Owner only. Returns pending invites (id, created_at, expires_at). Does not return the token or the URL — those are one-time values from `POST /households/mine/invites`. |

### Permission rules

- Rename: owner only.
- View member list: any member (already part of `GET /households/mine` from PR 1).
- Change role: owner only. Target must not be the owner themselves. New role must be `manager` or `viewer` — `owner` is set only via transfer.
- Remove member: owner only. Cannot remove themselves.
- Leave: any member who is not the current owner. The owner must transfer before leaving.
- Transfer ownership: owner only. Target must be an existing member of the same household. After transfer: target becomes `owner`, caller becomes `manager`. Both role changes are written as a single `ownership_transferred` audit log entry.
- List pending invites: owner only.
- All write actions produce audit log entries.

### Tests

**API**
- `PATCH /households/mine` renames the household; reflected in `GET /households/mine`.
- `PATCH /households/mine` by non-owner returns 403.
- `PATCH /households/mine` with empty or whitespace-only name returns 422.
- `PATCH /households/mine/members/:profileId` changes role; `GET /households/mine` reflects the change.
- `PATCH /households/mine/members/:profileId` with `role: "owner"` returns 422.
- Owner cannot change their own role via this route (403 or 422).
- `DELETE /households/mine/members/:profileId` removes the member; their subsequent `GET /swimmers/me` returns empty.
- `DELETE /households/mine/members/:profileId` on the current owner returns 403.
- `DELETE /households/mine/members/me` removes a non-owner; they can no longer call `GET /households/mine`.
- `DELETE /households/mine/members/me` by the owner returns 403 with transfer-first message.
- `POST /households/mine/transfer-ownership` to a valid member: caller becomes manager, target becomes owner.
- `POST /households/mine/transfer-ownership` to a non-member returns 404.
- `POST /households/mine/transfer-ownership` to self returns 422.
- All write actions produce audit log entries with correct action strings.
- `GET /households/mine/invites` returns pending invites; accepted and revoked invites are excluded.

**UI**
- Member list renders with correct role badge for each member.
- Owner sees change-role dropdown and remove button per member (except for their own row).
- Non-owner members see no change-role or remove controls.
- Owner row shows "Transfer ownership" instead of a remove button.
- Leave button is visible for non-owner members and absent for the owner (replaced by a note to transfer first).
- Transfer ownership flow shows a confirmation step naming the target member before submitting.
- Rename household inline edit saves on confirm and shows the new name.
- Pending invites section shows each invite's expiry time and a revoke button.
- Generate invite link button calls `POST /households/mine/invites` and displays the resulting URL for the owner to copy.

### Out of scope

- Moving swimmers between households.
- Household deletion.
- Notification when a new member joins (no email or push at this stage).
- An audit log viewer in the UI.
- Coach admin overrides of any household operation.
- One person in multiple households.
