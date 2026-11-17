"use client";

import { useState, useTransition } from "react";

import { resendConfirmationAction, type ResendState } from "./actions";

interface Props {
  email: string;
}

export default function ConfirmPendingContent({ email }: Props) {
  const [state, setState] = useState<ResendState>({ status: "idle" });
  const [submitting, startSubmitting] = useTransition();

  function handleResend(): void {
    if (submitting) return;
    startSubmitting(async () => {
      const result = await resendConfirmationAction();
      setState(result);
    });
  }

  return (
    <div className="flex flex-col flex-1">
      <main className="flex-1 flex items-center justify-center px-page py-16">
        <div className="w-full max-w-sm text-center flex flex-col gap-4">
          <h1 className="text-heading">Confirm your email</h1>
          <p className="text-text-secondary">
            We sent a confirmation link to{" "}
            <span className="font-semibold text-text">{email}</span>. Click it
            to activate your account. If the link expired, send a new one.
          </p>
          <button
            type="button"
            onClick={handleResend}
            disabled={submitting}
            className="min-h-[44px] rounded-full bg-accent text-on-accent font-bold disabled:opacity-60"
            data-testid="resend-confirmation"
          >
            {submitting ? "Sending…" : "Resend confirmation email"}
          </button>
          {state.status === "sent" && (
            <p role="status" className="text-sm text-text-secondary">
              Sent. Check your inbox (and spam folder).
            </p>
          )}
          {state.status === "error" && (
            <p role="alert" className="text-sm text-danger">
              {state.message}
            </p>
          )}
          {state.status === "no_session" && (
            <p role="alert" className="text-sm text-danger">
              Your session expired. Please sign in again.
            </p>
          )}
          <p className="text-xs text-text-secondary">
            Already confirmed?{" "}
            <a
              href="/dashboard"
              className="text-link hover:text-link-hover underline"
            >
              Open the dashboard
            </a>
            .
          </p>
        </div>
      </main>
    </div>
  );
}
