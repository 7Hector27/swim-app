"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { calculateAge, todayLA } from "@swim-app/shared";

import Button from "@/components/Button";
import PasswordInput from "@/components/PasswordInput";

import { signup } from "./actions";
import FieldError from "./FieldError";
import { AGE_ERROR, type SignupState } from "./helpers";
import SuccessScreen from "./SuccessScreen";

interface SignupContentProps {
  returnTo?: string;
}

const initialState: SignupState = { status: "idle" };

export default function SignupContent({ returnTo }: SignupContentProps) {
  const [state, formAction, isPending] = useActionState(signup, initialState);
  const [confirmPasswordError, setConfirmPasswordError] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmPasswordRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);

  const ageError =
    birthDate !== "" && calculateAge(birthDate, todayLA()) < 18 ? AGE_ERROR : "";

  useEffect(() => {
    if (state.status === "error" || state.status === "field_errors") {
      errorRef.current?.focus();
    }
  }, [state]);

  if (state.status === "success") return <SuccessScreen />;

  const fieldErrors = state.status === "field_errors" ? state.errors : {};
  const topError = state.status === "error" ? state.message : "";

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const password = passwordRef.current?.value ?? "";
    const confirmPassword = confirmPasswordRef.current?.value ?? "";
    if (password !== confirmPassword) {
      event.preventDefault();
      setConfirmPasswordError("Passwords don't match.");
      confirmPasswordRef.current?.focus();
      return;
    }
    setConfirmPasswordError("");
  }

  return (
    <div className="flex flex-col flex-1">
      <main className="flex-1 flex items-center justify-center px-page py-16">
        <div className="w-full max-w-md">
          <h1 className="text-heading mb-2">Create account</h1>
          <p className="text-text-secondary mb-8">Join Axiom Aquatics today.</p>

          <form action={formAction} noValidate onSubmit={handleSubmit} className="flex flex-col gap-5">
            {returnTo !== undefined && (
              <input type="hidden" name="returnTo" value={returnTo} />
            )}
            <p
              ref={errorRef}
              role="alert"
              aria-live="assertive"
              tabIndex={-1}
              style={{ outline: "none" }}
              className="text-danger text-sm min-h-5"
            >
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
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
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
                value={email}
                onChange={(e) => setEmail(e.target.value)}
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
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="h-12 px-4 rounded-lg border border-border bg-background text-text placeholder:text-text-secondary"
              />
              <FieldError message={fieldErrors["phone"]} />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="password" className="text-sm font-semibold text-text">
                Password
              </label>
              <PasswordInput
                id="password"
                name="password"
                autoComplete="new-password"
                required
                ref={passwordRef}
              />
              <p className="text-text-secondary text-xs">Minimum 8 characters</p>
              <FieldError message={fieldErrors["password"]} />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="confirmPassword" className="text-sm font-semibold text-text">
                Confirm password
              </label>
              <PasswordInput
                id="confirmPassword"
                name="confirmPassword"
                autoComplete="new-password"
                required
                ref={confirmPasswordRef}
                onChange={() => {
                  if (confirmPasswordError) setConfirmPasswordError("");
                }}
              />
              <FieldError message={confirmPasswordError || fieldErrors["confirmPassword"]} />
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
                value={birthDate}
                onChange={(event) => {
                  setBirthDate(event.target.value);
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
            <a
              href={returnTo !== undefined ? `/login?returnTo=${encodeURIComponent(returnTo)}` : "/login"}
              className="text-link underline hover:text-link-hover"
            >
              Log in
            </a>
          </p>
        </div>
      </main>
    </div>
  );
}
