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

## Who sees what

| Data                             | Coach        | Parent                  | Public                            |
| -------------------------------- | ------------ | ----------------------- | --------------------------------- |
| Swimmer ratings, times, progress | All swimmers | Only their own swimmers | Opted-in swimmers, limited fields |
| Coach notes                      | Yes          | No                      | No                                |
| Edit ratings, times, notes       | Yes          | No                      | No                                |
| Toggle a public profile          | Yes          | Their own swimmers      | No                                |

## Kids' data

- Public pages show opted-in swimmers only, as first name and last initial. Never birth date, contact info, or school.
- Opt-in records `consent_at` and who gave consent.
- Never log names, birth dates, emails, or notes.
