// Payload for the `password_changed` outbox event — a direct-to-user
// security alert fired after a successful password reset or change.
//
// The recipient is the auth user themselves (profileId mirrors
// auth.users.id). No household, no lesson, no family context — the row's
// scope columns are all NULL and the exactly-one CHECK carves out this
// event (same escape coach_account_deleted uses).

export type PasswordChangedSource = "reset" | "change";

export interface PasswordChangedEmailPayload {
  kind: "password_changed_email";
  // "reset" = completed via the /auth/reset-password recovery link.
  // "change" = authed /account change-password flow.
  source: PasswordChangedSource;
  // ISO UTC — purely informational in the body ("changed at …"). Formatted
  // at render time so the payload stays timezone-free.
  changedAtUtc: string;
  // Absolute link to /forgot-password so the recipient can re-reset if
  // they didn't do this. Built from env.siteUrl at enqueue time.
  resetPasswordUrl: string;
}
