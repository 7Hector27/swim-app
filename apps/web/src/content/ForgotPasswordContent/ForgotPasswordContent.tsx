"use client";

import { useActionState } from "react";

import Button from "@/components/Button";

import { forgotPassword, type ForgotPasswordState } from "./actions";

const initialState: ForgotPasswordState = { status: "idle", message: null };

export default function ForgotPasswordContent() {
  const [state, formAction, isPending] = useActionState(forgotPassword, initialState);

  return (
    <div className="flex flex-col flex-1">
      <main className="flex-1 flex items-center justify-center px-page py-16">
        <div className="w-full max-w-sm">
          <h1 className="text-heading mb-2">Forgot password?</h1>
          <p className="text-text-secondary mb-8">
            Enter your account email and we&apos;ll send a reset link.
          </p>

          <form action={formAction} noValidate className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="email" className="text-sm font-semibold text-text">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                className="h-12 px-4 rounded-lg border border-border bg-background text-text placeholder:text-text-secondary"
              />
            </div>

            <p
              role="status"
              aria-live="polite"
              className="text-text-secondary text-sm min-h-5"
            >
              {state.message ?? ""}
            </p>

            <Button type="submit" disabled={isPending} className="w-full">
              {isPending ? "Sending\u2026" : "Send reset link"}
            </Button>
          </form>

          <p className="text-center text-sm text-text-secondary mt-6">
            Remembered it?{" "}
            <a href="/login" className="text-link underline hover:text-link-hover">
              Back to sign in
            </a>
          </p>
        </div>
      </main>
    </div>
  );
}
