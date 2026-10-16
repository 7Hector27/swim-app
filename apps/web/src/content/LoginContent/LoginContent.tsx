"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import Button from "@/components/Button";

import { login } from "./actions";

interface LoginContentProps {
  notice?: string;
  returnTo?: string;
}

export default function LoginContent({ notice, returnTo }: LoginContentProps) {
  const [state, formAction, isPending] = useActionState(login, { error: null });
  const [email, setEmail] = useState("");
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (state.error) {
      errorRef.current?.focus();
    }
  }, [state.error]);

  return (
    <div className="flex flex-col flex-1">
      <main className="flex-1 flex items-center justify-center px-page py-16">
        <div className="w-full max-w-sm">
          <h1 className="text-heading mb-2">Sign in</h1>
          <p className="text-text-secondary mb-8">Welcome back to Axiom Aquatics.</p>

          <p aria-live="polite" role="status" className="text-text-secondary text-sm min-h-5 mb-4">
            {notice ?? ""}
          </p>

          <form action={formAction} noValidate className="flex flex-col gap-5">
            {returnTo !== undefined && (
              <input type="hidden" name="returnTo" value={returnTo} />
            )}
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
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-12 px-4 rounded-lg border border-border bg-background text-text placeholder:text-text-secondary"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="password" className="text-sm font-semibold text-text">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className="h-12 px-4 rounded-lg border border-border bg-background text-text"
              />
            </div>

            <p
              ref={errorRef}
              role="alert"
              aria-live="assertive"
              tabIndex={-1}
              style={{ outline: "none" }}
              className="text-danger text-sm min-h-5"
            >
              {state.error ?? ""}
            </p>

            <Button type="submit" disabled={isPending} className="w-full">
              {isPending ? "Signing in\u2026" : "Sign in"}
            </Button>
          </form>

          <p className="text-center text-sm text-text-secondary mt-6">
            New here?{" "}
            <a
              href={returnTo !== undefined ? `/signup?returnTo=${encodeURIComponent(returnTo)}` : "/signup"}
              className="text-link underline hover:text-link-hover"
            >
              Create an account
            </a>
          </p>
        </div>
      </main>
    </div>
  );
}
