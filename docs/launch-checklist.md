# Launch checklist

Items that require human sign-off before the app goes live. Engineering items go in the relevant plan docs; this file tracks non-code gates.

---

## Accounts and hosting

- [ ] Jason has created a dedicated business Gmail account that owns the Vercel, Railway, and Supabase projects (not his personal Gmail).
- [ ] Dev environment is live and smoke-tested before production is provisioned.
- [ ] Production environment is provisioned after dev, following the same steps in sequence.
- [ ] Production migration process is documented; migrations are never run automatically — always manual, with a backup taken first.
- [ ] A real transactional email provider (e.g., Resend) is configured for both auth emails (Supabase SMTP settings) and notification emails. Supabase's built-in rate-limited relay is not used in production.
- [ ] Supabase email templates (confirmation, magic link, invite, password reset, email change) are copied into every hosted Supabase project (dev and production) via the Auth → Email Templates UI. Supabase resets templates on project recreation.
- [ ] In each hosted Supabase project, confirm the **Site URL** setting matches the deployed site origin so that `{{ .SiteURL }}/logos/axiom-aquatics-lockup.png` in the email templates resolves to the correct logo. Local dev uses `http://localhost:3000`; production must use the live domain.
- [ ] Production Supabase redirect URLs include `/auth/confirm` with the correct query-param shape (`token_hash`, `type`, `next`). Every signup and invite path passes `emailRedirectTo` pointing to the correct origin.

---

## Site content and settings

- [ ] `SHOW_PLACEHOLDERS` is set to `false` in the production environment before launch.
- [ ] `SHOW_HERO_PHOTO` decision is made. If a swimmer photo is used: written parent consent is on file, and any location-identifying metadata (EXIF GPS, background landmarks) is stripped before upload.
- [ ] In-app booking is live and the Calendly link has been removed from Jason's social profiles and public page.
- [ ] Jason's business email address replaces his personal Gmail in `siteLinks` (contact link, footer).
- [ ] FAQ pricing table is up to date: no 2-swimmer package listed; 3-sibling package details confirmed or removed.
- [ ] Jason has reviewed and approved the final hero copy, coach bio, and FAQ text.
- [ ] Jason's actual summer teaching hours are entered in `availability_config` (morning and evening windows are currently placeholder values).
- [ ] This season's summer end date is set in `season_summer_end_dates` for the current year.

---

## Clubs

- [ ] Replace the placeholder clubs (`[Club 1]`, `[Club 2]`) with Jason's list of local clubs. Run `pnpm db:sync-catalog` (or a migration) to update the `clubs` table in each environment.

---

## Skills and evaluations

- [ ] Skill structure (categories, skill list, level descriptors, fault tags) is locked in with Jason before any real swimmers are rated. Changes to skill slugs after ratings exist require a migration and a data backfill.
- [ ] Bilateral breathing composite formula and fly breakout distance links are confirmed with Jason as correct before launch.

---

## Privacy and legal

- [ ] Privacy policy and terms of service are finalized and live at `/privacy` and `/terms`.
- [ ] Privacy policy discloses that an unsaved evaluation draft is held on the coach's device (in browser state) until explicitly saved, and is not transmitted to the server until save is triggered.
- [ ] Privacy policy or in-app copy clarifies that parents can view the coaching priority that Jason writes for each evaluation session (it appears on the swimmer progress page).

---

## Leaderboards

- [ ] Public leaderboard routes are covered in the lawyer review before launch.
- [ ] Confirm that only swimmers with `is_public = true` appear in all leaderboard queries; spot-check the API and any cached/rendered output.
