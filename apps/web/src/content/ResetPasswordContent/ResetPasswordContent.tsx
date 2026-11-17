"use client";

import { useActionState, useRef } from "react";

import { PASSWORD_MIN_LENGTH } from "@swim-app/shared";

import Button from "@/components/Button";
import PasswordInput from "@/components/PasswordInput";

import { completeReset, type ResetSubmitState } from "./actions";
import { PASSWORD_RULE_HELP } from "./helpers";

interface Props {
  tokenHash: string | null;
  type: string | null;
}

const initialState: ResetSubmitState = { status: "idle" };

export default function ResetPasswordContent({ tokenHash, type }: Props) {
  // Preflight: if the link didn't carry the two params Supabase includes,
  // show the error UI without even rendering the form. The server action
  // also re-validates — don't trust the browser to keep this honest.
  const linkLooksValid = typeof tokenHash === "string" && tokenHash.length > 0 && type === "recovery";

  const [state, formAction, isPending] = useActionState(completeReset, initialState);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmPasswordRef = useRef<HTMLInputElement>(null);

  if (!linkLooksValid || state.status === "invalid_link") {
    return (
      <PageShell>
        <h1 className="text-heading mb-2">That link didn&apos;t work.</h1>
        <p className="text-text-secondary mb-6">
          Reset links expire after a short time and can only be used once.
          Request a new one.
        </p>
        <a
          href="/forgot-password"
          className="inline-flex h-12 px-7 items-center justify-center rounded-lg font-bold bg-primary text-primary-contrast hover:bg-primary-hover"
        >
          Request a new link
        </a>
      </PageShell>
    );
  }

  const confirmError = state.status === "mismatch" ? "Passwords don't match." : "";
  const passwordError = state.status === "weak_password" ? PASSWORD_RULE_HELP : "";
  const topError = state.status === "error" ? state.message : "";

  return (
    <PageShell>
      <h1 className="text-heading mb-2">Set a new password</h1>
      <p className="text-text-secondary mb-8">{PASSWORD_RULE_HELP}</p>

      <form action={formAction} noValidate className="flex flex-col gap-5">
        <input type="hidden" name="tokenHash" value={tokenHash ?? ""} />

        <div className="flex flex-col gap-1.5">
          <label htmlFor="newPassword" className="text-sm font-semibold text-text">
            New password
          </label>
          <PasswordInput
            id="newPassword"
            name="newPassword"
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            required
            ref={passwordRef}
          />
          {passwordError && (
            <p className="text-danger text-xs mt-1">{passwordError}</p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="confirmPassword" className="text-sm font-semibold text-text">
            Confirm new password
          </label>
          <PasswordInput
            id="confirmPassword"
            name="confirmPassword"
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            required
            ref={confirmPasswordRef}
          />
          {confirmError && (
            <p className="text-danger text-xs mt-1">{confirmError}</p>
          )}
        </div>

        <p role="alert" aria-live="assertive" className="text-danger text-sm min-h-5">
          {topError}
        </p>

        <Button type="submit" disabled={isPending} className="w-full">
          {isPending ? "Updating\u2026" : "Update password"}
        </Button>
      </form>
    </PageShell>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col flex-1">
      <main className="flex-1 flex items-center justify-center px-page py-16">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  );
}
