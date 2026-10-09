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
