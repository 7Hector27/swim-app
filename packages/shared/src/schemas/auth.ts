import { z } from "zod";
import { todayLA } from "../lib/todayLA";

export const SignUpBodySchema = z
  .object({
    fullName: z.string().trim().min(1).max(100),
    email: z.string().email(),
    phone: z.string().max(30).nullable().optional(),
    password: z.string().min(8),
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
