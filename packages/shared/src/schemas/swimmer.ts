import { z } from "zod";

// ── Enums ─────────────────────────────────────────────────────────────────────

export const SexSchema = z.enum(["female", "male"]);
export type Sex = z.infer<typeof SexSchema>;

// ── Swimmer ───────────────────────────────────────────────────────────────────

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
