"use client";

import { useActionState, useState } from "react";

import Button from "@/components/Button";
import SiteFooter from "@/components/SiteFooter";
import SiteNav from "@/components/SiteNav";

import { signup } from "./actions";
import type { SignupState } from "./helpers";

function FieldError({ message }: { message: string | undefined }) {
  if (!message) return null;
  return <p className="text-danger text-xs mt-1">{message}</p>;
}

function AgeBlockedScreen() {
  return (
    <div className="flex flex-col min-h-screen">
      <SiteNav />
      <main className="flex-1 flex items-center justify-center px-page py-16">
        <div className="w-full max-w-sm text-center">
          <h1 className="text-heading mb-4">Not available</h1>
          <p className="text-text-secondary">
            Ask a parent or guardian to create an account.
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

function SuccessScreen() {
  return (
    <div className="flex flex-col min-h-screen">
      <SiteNav />
      <main className="flex-1 flex items-center justify-center px-page py-16">
        <div className="w-full max-w-sm text-center">
          <h1 className="text-heading mb-4">Check your email</h1>
          <p className="text-text-secondary">
            We sent a confirmation link to your email address. Click it to activate your account.
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

function isUnder18(birthDateValue: string): boolean {
  const birth = new Date(birthDateValue);
  if (isNaN(birth.getTime())) return false;
  const today = new Date();
  const cutoff = new Date(birth.getFullYear() + 18, birth.getMonth(), birth.getDate());
  return today < cutoff;
}

const initialState: SignupState = { status: "idle" };

export default function SignupContent() {
  const [state, formAction, isPending] = useActionState(signup, initialState);
  const [clientAgeBlocked, setClientAgeBlocked] = useState(false);

  if (clientAgeBlocked || state.status === "age_blocked") return <AgeBlockedScreen />;
  if (state.status === "success") return <SuccessScreen />;

  const fieldErrors = state.status === "field_errors" ? state.errors : {};
  const topError = state.status === "error" ? state.message : "";

  return (
    <div className="flex flex-col min-h-screen">
      <SiteNav />
      <main className="flex-1 flex items-center justify-center px-page py-16">
        <div className="w-full max-w-md">
          <h1 className="text-heading mb-2">Create account</h1>
          <p className="text-text-secondary mb-8">Join JG Swim today.</p>

          <form action={formAction} noValidate className="flex flex-col gap-5">
            <p aria-live="polite" className="text-danger text-sm min-h-5">
              {topError}
            </p>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="fullName" className="text-sm font-semibold text-text">
                Full name
              </label>
              <input
                id="fullName"
                name="fullName"
                type="text"
                autoComplete="name"
                required
                className="h-12 px-4 rounded-lg border border-border bg-background text-text placeholder:text-text-secondary"
              />
              <FieldError message={fieldErrors["fullName"]} />
            </div>

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
              <FieldError message={fieldErrors["email"]} />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="phone" className="text-sm font-semibold text-text">
                Phone{" "}
                <span className="font-normal text-text-secondary">(optional)</span>
              </label>
              <input
                id="phone"
                name="phone"
                type="tel"
                autoComplete="tel"
                className="h-12 px-4 rounded-lg border border-border bg-background text-text placeholder:text-text-secondary"
              />
              <FieldError message={fieldErrors["phone"]} />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="password" className="text-sm font-semibold text-text">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                className="h-12 px-4 rounded-lg border border-border bg-background text-text"
              />
              <p className="text-text-secondary text-xs">Minimum 8 characters</p>
              <FieldError message={fieldErrors["password"]} />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="birthDate" className="text-sm font-semibold text-text">
                Date of birth
              </label>
              <input
                id="birthDate"
                name="birthDate"
                type="date"
                autoComplete="bday"
                required
                onChange={(event) => {
                  if (event.target.value) setClientAgeBlocked(isUnder18(event.target.value));
                }}
                className="h-12 px-4 rounded-lg border border-border bg-background text-text"
              />
              <FieldError message={fieldErrors["birthDate"]} />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  name="acceptedTerms"
                  type="checkbox"
                  className="mt-0.5 w-4 h-4 shrink-0 accent-button-primary-background"
                />
                <span className="text-sm text-text">
                  I agree to the{" "}
                  <a href="/terms" className="text-link underline hover:text-link-hover">
                    Terms of Service
                  </a>{" "}
                  and{" "}
                  <a href="/privacy" className="text-link underline hover:text-link-hover">
                    Privacy Policy
                  </a>
                </span>
              </label>
              <FieldError message={fieldErrors["acceptedTerms"]} />
            </div>

            <Button type="submit" disabled={isPending} className="w-full mt-2">
              {isPending ? "Creating account\u2026" : "Create account"}
            </Button>
          </form>

          <p className="text-center text-sm text-text-secondary mt-6">
            Already have an account?{" "}
            <a href="/login" className="text-link underline hover:text-link-hover">
              Log in
            </a>
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
