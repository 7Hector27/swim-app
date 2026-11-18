"use client";

import { useActionState, useRef } from "react";

import { PASSWORD_MIN_LENGTH } from "@swim-app/shared";

import Button from "@/components/Button";
import PasswordInput from "@/components/PasswordInput";

import { changePassword, type ChangePasswordState } from "./changePasswordAction";

function FieldError({ message }: { message: string | undefined }) {
  if (!message) return null;
  return <p className="text-danger text-xs mt-1">{message}</p>;
}

const initialState: ChangePasswordState = { status: "idle" };

export default function ChangePasswordForm() {
  const [state, formAction, isPending] = useActionState(changePassword, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  const fieldErrors = state.status === "field_errors" ? state.errors : {};
  const topError = state.status === "error" ? state.message : "";

  // Clear the inputs after a successful change so the next render shows
  // empty fields alongside the success note (the user doesn't need the
  // old new-password hanging around).
  if (state.status === "success") {
    formRef.current?.reset();
  }

  return (
    <form ref={formRef} action={formAction} noValidate className="flex flex-col gap-5">
      {state.status === "success" && (
        <p role="status" aria-live="polite" className="text-success text-sm">
          Password updated.
        </p>
      )}
      {topError && (
        <p role="alert" aria-live="assertive" className="text-danger text-sm">
          {topError}
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="currentPassword" className="text-sm font-semibold text-text">
          Current password
        </label>
        <PasswordInput
          id="currentPassword"
          name="currentPassword"
          autoComplete="current-password"
          required
        />
        <FieldError message={fieldErrors.currentPassword} />
      </div>

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
        />
        <p className="text-xs text-text-secondary">
          Must be at least {PASSWORD_MIN_LENGTH} characters.
        </p>
        <FieldError message={fieldErrors.newPassword} />
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
        />
        <FieldError message={fieldErrors.confirmPassword} />
      </div>

      <Button type="submit" disabled={isPending}>
        {isPending ? "Updating\u2026" : "Change password"}
      </Button>
    </form>
  );
}
