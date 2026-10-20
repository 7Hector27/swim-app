import type { ParentSwimmer, SwimmerClubInput, UpdateSwimmerBody } from "@swim-app/shared";

import { isApiBody, mapZodErrors } from "@/lib/mapZodErrors";

export type EditSwimmerState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "field_errors"; errors: Record<string, string> };

export type RemoveSwimmerState = { status: "idle" } | { status: "error"; message: string };

export function mapApiResponse(
  status: number,
  body: unknown,
): Exclude<EditSwimmerState, { status: "idle" }> {
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

export function mapPublicToggleApiResponse(httpStatus: number): PublicToggleState {
  if (httpStatus === 200) return { status: "idle" };
  if (httpStatus === 403) {
    return { status: "error", message: "Only the household owner can make a swimmer public." };
  }
  if (httpStatus === 404) {
    return { status: "error", message: "Swimmer not found. Please return to the dashboard." };
  }
  return { status: "error", message: "Something went wrong. Please try again." };
}

export function toClubInputs(clubs: ParentSwimmer["clubs"]): SwimmerClubInput[] {
  const result: SwimmerClubInput[] = [];
  for (const c of clubs) {
    if (c.clubId !== null) {
      result.push({ clubId: c.clubId });
    } else if (c.otherClubName !== null) {
      result.push({ otherClubName: c.otherClubName });
    }
  }
  return result;
}

type SwimmerSnapshot = {
  firstName: string;
  lastName: string;
  birthDate: string;
  sex: "female" | "male";
  isPublic: boolean;
  clubs: SwimmerClubInput[];
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

function clubsEqual(a: SwimmerClubInput[], b: SwimmerClubInput[]): boolean {
  if (a.length !== b.length) return false;
  const serialize = (c: SwimmerClubInput): string =>
    "clubId" in c ? `id:${c.clubId}` : `other:${c.otherClubName}`;
  const setA = new Set(a.map(serialize));
  const setB = new Set(b.map(serialize));
  if (setA.size !== setB.size) return false;
  for (const item of setA) {
    if (!setB.has(item)) return false;
  }
  return true;
}
