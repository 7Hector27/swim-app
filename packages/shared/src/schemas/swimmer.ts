import { z } from "zod";
import { todayLA } from "../lib/todayLA";

// ── Enums ─────────────────────────────────────────────────────────────────────

export const SexSchema = z.enum(["female", "male"]);
export type Sex = z.infer<typeof SexSchema>;

// ── Swimmer ───────────────────────────────────────────────────────────────────

/** Internal only — never use as a response schema. Contains sensitive fields (publicConsentBy, archivedAt) that must not be sent to clients. */
export const SwimmerBaseSchema = z.object({
  id: z.string().uuid(),
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  birthDate: z.string().date(),
  sex: SexSchema,
  isPublic: z.boolean(),
  publicConsentAt: z.string().datetime({ offset: true }).nullable(),
  publicConsentBy: z.string().uuid().nullable(),
  archivedAt: z.string().datetime({ offset: true }).nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

/** Internal only — never use as a response schema. See SwimmerBaseSchema. */
export const SwimmerSchema = SwimmerBaseSchema.refine(
  (data) =>
    !data.isPublic ||
    (data.publicConsentAt !== null && data.publicConsentBy !== null),
  {
    message:
      "publicConsentAt and publicConsentBy are required when isPublic is true",
    path: ["publicConsentAt"],
  },
);

export type Swimmer = z.infer<typeof SwimmerSchema>;

// ── Guardian ──────────────────────────────────────────────────────────────────

/** Internal/coach-only — never returned to parents or the public. */
export const GuardianSchema = z.object({
  profileId: z.string().uuid(),
  swimmerId: z.string().uuid(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export type Guardian = z.infer<typeof GuardianSchema>;

// ── Club ──────────────────────────────────────────────────────────────────────

export const ClubSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  isActive: z.boolean(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export type Club = z.infer<typeof ClubSchema>;

// ── SwimmerClub ───────────────────────────────────────────────────────────────

export const SwimmerClubBaseSchema = z.object({
  id: z.string().uuid(),
  swimmerId: z.string().uuid(),
  clubId: z.string().uuid().nullable(),
  otherClubName: z.string().trim().min(1).nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

// Mirrors the DB CHECK: exactly one of clubId or otherClubName must be set.
export const SwimmerClubSchema = SwimmerClubBaseSchema.refine(
  (data) =>
    (data.clubId !== null && data.otherClubName === null) ||
    (data.clubId === null && data.otherClubName !== null),
  {
    message: "exactly one of clubId or otherClubName must be set",
    path: ["clubId"],
  },
);

export type SwimmerClub = z.infer<typeof SwimmerClubSchema>;

// ── API input schemas (client-facing) ────────────────────────────────────────

export const SwimmerClubInputSchema = z.union([
  z.object({ clubId: z.string().uuid() }),
  z.object({ otherClubName: z.string().trim().min(1) }),
]);

export type SwimmerClubInput = z.infer<typeof SwimmerClubInputSchema>;

export const CreateSwimmerBodySchema = z
  .object({
    firstName: z.string().trim().min(1),
    lastName: z.string().trim().min(1),
    birthDate: z
      .string()
      .date()
      .refine((val) => val < todayLA(), "Birth date must be in the past"),
    sex: SexSchema,
    isPublic: z.boolean(),
    clubs: z.array(SwimmerClubInputSchema),
  })
  .strict();

export type CreateSwimmerBody = z.infer<typeof CreateSwimmerBodySchema>;

export const UpdateSwimmerBodySchema = z
  .object({
    firstName: z.string().trim().min(1).optional(),
    lastName: z.string().trim().min(1).optional(),
    birthDate: z
      .string()
      .date()
      .refine((val) => val < todayLA(), "Birth date must be in the past")
      .optional(),
    sex: SexSchema.optional(),
    isPublic: z.boolean().optional(),
    clubs: z.array(SwimmerClubInputSchema).optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: "At least one field is required",
  });

export type UpdateSwimmerBody = z.infer<typeof UpdateSwimmerBodySchema>;

// ── API response schemas ──────────────────────────────────────────────────────

export const ParentSwimmerSchema = z.object({
  id: z.string().uuid(),
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  birthDate: z.string().date(),
  sex: SexSchema,
  isPublic: z.boolean(),
  publicConsentAt: z.string().datetime({ offset: true }).nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  clubs: z.array(SwimmerClubSchema),
});

export type ParentSwimmer = z.infer<typeof ParentSwimmerSchema>;

export const PublicSwimmerSchema = z.object({
  id: z.string().uuid(),
  firstName: z.string().trim().min(1),
  lastInitial: z.string().length(1),
  sex: SexSchema,
  isPublic: z.literal(true),
});

export type PublicSwimmer = z.infer<typeof PublicSwimmerSchema>;
