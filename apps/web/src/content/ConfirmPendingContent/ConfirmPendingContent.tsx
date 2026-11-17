"use client";

import { useEffect, useState, useTransition } from "react";

import { resendConfirmationAction, type ResendState } from "./actions";

interface Props {
  email: string;
}

// Seconds the Resend button stays disabled after a successful send.
// Supabase's per-email throttle is the authoritative rate limit; this
// client-side cooldown just stops a jittery user (or a bored page) from
// hammering the button in a loop before the throttle would answer.
const RESEND_COOLDOWN_SECONDS = 60;

export default function ConfirmPendingContent({ email }: Props) {
  const [state, setState] = useState<ResendState>({ status: "idle" });
  const [submitting, startSubmitting] = useTransition();
  const [cooldownSeconds, setCooldownSeconds] = useState(0);

  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const timer = window.setTimeout(() => {
      setCooldownSeconds((prev) => prev - 1);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [cooldownSeconds]);

  function handleResend(): void {
    if (submitting || cooldownSeconds > 0) return;
    startSubmitting(async () => {
      const result = await resendConfirmationAction();
      setState(result);
      if (result.status === "sent") {
        setCooldownSeconds(RESEND_COOLDOWN_SECONDS);
      }
    });
  }

  const disabled = submitting || cooldownSeconds > 0;
  const buttonLabel = submitting
    ? "Sending…"
    : cooldownSeconds > 0
      ? `Resend in ${cooldownSeconds}s`
      : "Resend confirmation email";

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
            disabled={disabled}
            className="min-h-[44px] rounded-full bg-accent text-on-accent font-bold disabled:opacity-60"
            data-testid="resend-confirmation"
          >
            {buttonLabel}
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
