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

## Who sees what

| Data                             | Coach        | Parent                  | Public                            |
| -------------------------------- | ------------ | ----------------------- | --------------------------------- |
| Swimmer ratings, times, progress | All swimmers | Only their own swimmers | Opted-in swimmers, limited fields |
| Coach notes                      | Yes          | No                      | No                                |
| Edit ratings, times, notes       | Yes          | No                      | No                                |
| Set is_public to true            | No           | Their own swimmers (guardian only) | No                          |
| Set is_public to false           | Yes          | Their own swimmers      | No                                |

## Kids' data

- **Birth dates are stored** for swimmers. This differs from the age check at parent signup (where the birth date is verified and then discarded). Swimmer birth dates are required permanently to calculate age groups for competition. See ADR 016.
- **Tracking is always on.** Every swimmer in the system is tracked (times, assessments, progress). There is no opt-out from tracking itself.
- **`is_public` controls public display only.** A swimmer with `is_public = false` is tracked normally but never appears on public leaderboards or pages. Setting `is_public = true` requires explicit parent consent recorded in `public_consent_at` and `public_consent_by`.
- **Only a guardian of the swimmer can set `is_public` to `true`.** The server verifies the authenticated caller is in the `guardians` table for that swimmer, then records their profile ID as `public_consent_by` and the current timestamp as `public_consent_at`. The client never supplies these fields. Coaches cannot set `is_public` to `true`.
- **Any guardian or the coach can set `is_public` to `false`.** No consent re-check is needed to opt out.
- **Turning `is_public` off keeps the last consent fields as an audit trail.** `public_consent_at` and `public_consent_by` are not cleared when `is_public` is set back to `false`. Turning it back on records new consent by overwriting both fields with the current timestamp and caller. Re-sending `is_public: true` when the swimmer is already public does **not** refresh the consent fields — the existing `public_consent_at` and `public_consent_by` are preserved.
- **Swimmers are soft-deleted via `archived_at`.** Setting `archived_at` to a non-null timestamp hides the swimmer from active views. The row and all associated data are retained.
- **Every swimmer query must exclude archived rows.** All queries against the `swimmers` table must include `WHERE archived_at IS NULL` (Drizzle: `.where(isNull(swimmers.archivedAt))`). There is no DB-level filter enforcing this automatically — it is a required convention for every route.
- **Profiles are never hard-deleted.** Profiles referenced by swimmers or consent records must remain as rows. Closing an account disables the profile (`disabled_at`) and scrubs its personal fields; the full account deletion flow is out of scope for now.
- **Clubs are never deleted, only deactivated.** Setting `is_active = false` on a `clubs` row hides it from new registrations but preserves all existing `swimmer_clubs` references. Hard-deleting a club is blocked by the `ON DELETE RESTRICT` FK on `swimmer_clubs.club_id`.
- Public pages show opted-in swimmers only, as first name and last initial. Never birth date, contact info, or school.
- Never log names, birth dates, emails, or notes.
