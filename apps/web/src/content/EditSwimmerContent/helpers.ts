import { z } from "zod";

import { SwimmerClubInputSchema } from "@swim-app/shared";
import type { ParentSwimmer, UpdateSwimmerBody } from "@swim-app/shared";

import { isApiBody, mapZodErrors } from "@/lib/mapZodErrors";

export type EditSwimmerState =
  | { status: "idle" }
  | { status: "no_changes" }
  | { status: "error"; message: string }
  | { status: "field_errors"; errors: Record<string, string> };

export type RemoveSwimmerState = { status: "idle" } | { status: "error"; message: string };

export function mapApiResponse(
  status: number,
  body: unknown,
): Exclude<EditSwimmerState, { status: "idle" } | { status: "no_changes" }> {
  if (status === 400) {
    return {
      status: "error",
      message:
        "One or more selected clubs are no longer available. Please refresh and try again.",
    };
  }
  if (status === 403) {
    return { status: "error", message: "You don't have permission to make this change." };
  }
  if (status === 404) {
    return { status: "error", message: "Swimmer not found. Please return to the dashboard." };
  }
  if (status === 422 && isApiBody(body) && Array.isArray(body.issues)) {
    return { status: "field_errors", errors: mapZodErrors(body.issues) };
  }
  return { status: "error", message: "Something went wrong. Please try again." };
}

export type PublicToggleState = { status: "idle" } | { status: "error"; message: string };

export function mapPublicToggleApiResponse(
  httpStatus: number,
  direction: "enable" | "disable",
): PublicToggleState {
  if (httpStatus === 200) return { status: "idle" };
  if (httpStatus === 403) {
    return {
      status: "error",
      message:
        direction === "enable"
          ? "Only the household owner can make a swimmer public."
          : "You don't have permission to remove this swimmer from leaderboards.",
    };
  }
  if (httpStatus === 404) {
    return { status: "error", message: "Swimmer not found. Please return to the dashboard." };
  }
  return { status: "error", message: "Something went wrong. Please try again." };
}

export const InitialSnapshotSchema = z.object({
  firstName: z.string(),
  lastName: z.string(),
  birthDate: z.string(),
  sex: z.enum(["female", "male"]),
  isPublic: z.boolean(),
  clubs: z.array(SwimmerClubInputSchema),
});

export type InitialSnapshot = z.infer<typeof InitialSnapshotSchema>;

export function toClubInputs(clubs: ParentSwimmer["clubs"]) {
  const result: Array<{ clubId: string } | { otherClubName: string }> = [];
  for (const c of clubs) {
    if (c.clubId !== null) {
      result.push({ clubId: c.clubId });
    } else if (c.otherClubName !== null) {
      result.push({ otherClubName: c.otherClubName });
    }
  }
  return result;
}

type ClubInput = { clubId: string } | { otherClubName: string };

type SwimmerSnapshot = {
  firstName: string;
  lastName: string;
  birthDate: string;
  sex: "female" | "male";
  isPublic: boolean;
  clubs: ClubInput[];
};

export function getChangedFields(
  initial: SwimmerSnapshot,
  updated: SwimmerSnapshot,
): UpdateSwimmerBody | null {
  const body: Partial<SwimmerSnapshot> = {};

  if (updated.firstName !== initial.firstName) body.firstName = updated.firstName;
  if (updated.lastName !== initial.lastName) body.lastName = updated.lastName;
  if (updated.birthDate !== initial.birthDate) body.birthDate = updated.birthDate;
  if (updated.sex !== initial.sex) body.sex = updated.sex;
  if (updated.isPublic !== initial.isPublic) body.isPublic = updated.isPublic;
  if (!clubsEqual(initial.clubs, updated.clubs)) body.clubs = updated.clubs;

  if (Object.keys(body).length === 0) return null;
  return body as UpdateSwimmerBody;
}

function clubsEqual(a: ClubInput[], b: ClubInput[]): boolean {
  if (a.length !== b.length) return false;
  const serialize = (c: ClubInput): string =>
    "clubId" in c ? `id:${c.clubId}` : `other:${c.otherClubName}`;
  const setA = new Set(a.map(serialize));
  const setB = new Set(b.map(serialize));
  if (setA.size !== setB.size) return false;
  for (const item of setA) {
    if (!setB.has(item)) return false;
  }
  return true;
}
