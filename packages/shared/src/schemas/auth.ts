import { z } from "zod";
import { todayLA } from "../lib/todayLA";

// Password rules shared by signup, reset, and change flows. Keep the rule
// surface here so a tightening (length, complexity) lands in one place.
export const PASSWORD_MIN_LENGTH = 8;
export const PasswordSchema = z.string().min(PASSWORD_MIN_LENGTH);

export const SignUpBodySchema = z
  .object({
    fullName: z.string().trim().min(1).max(100),
    email: z.string().email(),
    phone: z.string().max(30).nullable().optional(),
    password: PasswordSchema,
    birthDate: z
      .string()
      .date()
      .refine((val) => val < todayLA(), "Birth date must be in the past"),
    acceptedTerms: z.literal(true),
    // ADR 036 Phase 8 Part B Stop 3: signup records acceptance per
    // policy at the version the user actually saw. The web form carries
    // these as hidden inputs driven by the server-rendered page's
    // TERMS_VERSION / PRIVACY_VERSION / PAYMENTS_REFUND_VERSION imports.
    // The API rejects the signup with 422 stale_policy_versions if any
    // submitted version is behind the current constant.
    acceptedPolicyVersions: z
      .object({
        terms: z.string().min(1),
        privacy: z.string().min(1),
        payments_refund: z.string().min(1),
      })
      .strict(),
    returnTo: z.string().optional(),
  })
  .strict();

export type SignUpBody = z.infer<typeof SignUpBodySchema>;

export const LoginBodySchema = z
  .object({
    email: z.string().email(),
    password: z.string().min(1),
  })
  .strict();

export type LoginBody = z.infer<typeof LoginBodySchema>;

export const ForgotPasswordBodySchema = z
  .object({
    email: z.string().email(),
  })
  .strict();

export type ForgotPasswordBody = z.infer<typeof ForgotPasswordBodySchema>;

export const ChangePasswordBodySchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: PasswordSchema,
  })
  .strict();

export type ChangePasswordBody = z.infer<typeof ChangePasswordBodySchema>;
