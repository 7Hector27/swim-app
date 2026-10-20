import { describe, expect, it } from "vitest";

import {
  getChangedFields,
  mapApiResponse,
  mapPublicToggleApiResponse,
  toClubInputs,
} from "../content/EditSwimmerContent/helpers";
import type { ParentSwimmer } from "@swim-app/shared";

const baseClub: ParentSwimmer["clubs"][number] = {
  id: "cccccccc-0000-4000-8000-000000000001",
  swimmerId: "dddddddd-0000-4000-8000-000000000001",
  clubId: "eeeeeeee-0000-4000-8000-000000000001",
  otherClubName: null,
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z",
};

const otherClub: ParentSwimmer["clubs"][number] = {
  id: "cccccccc-0000-4000-8000-000000000002",
  swimmerId: "dddddddd-0000-4000-8000-000000000001",
  clubId: null,
  otherClubName: "Dolphins SC",
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z",
};

describe("toClubInputs", () => {
  it("maps a club-id entry to { clubId }", () => {
    const result = toClubInputs([baseClub]);
    expect(result).toEqual([{ clubId: baseClub.clubId }]);
  });

  it("maps an other-club entry to { otherClubName }", () => {
    const result = toClubInputs([otherClub]);
    expect(result).toEqual([{ otherClubName: "Dolphins SC" }]);
  });

  it("skips entries where both clubId and otherClubName are null", () => {
    const broken = { ...baseClub, clubId: null, otherClubName: null };
    const result = toClubInputs([broken]);
    expect(result).toHaveLength(0);
  });

  it("handles multiple clubs", () => {
    const result = toClubInputs([baseClub, otherClub]);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ clubId: baseClub.clubId });
    expect(result[1]).toEqual({ otherClubName: "Dolphins SC" });
  });

  it("returns empty array for empty input", () => {
    expect(toClubInputs([])).toEqual([]);
  });
});

const baseSnapshot = {
  firstName: "Alice",
  lastName: "Smith",
  birthDate: "2010-06-01",
  sex: "female" as const,
  isPublic: false,
  clubs: [] as Array<{ clubId: string } | { otherClubName: string }>,
};

describe("getChangedFields", () => {
  it("returns null when nothing changed", () => {
    expect(getChangedFields(baseSnapshot, { ...baseSnapshot })).toBeNull();
  });

  it("detects firstName change", () => {
    const result = getChangedFields(baseSnapshot, { ...baseSnapshot, firstName: "Alicia" });
    expect(result).toEqual({ firstName: "Alicia" });
  });

  it("detects lastName change", () => {
    const result = getChangedFields(baseSnapshot, { ...baseSnapshot, lastName: "Jones" });
    expect(result).toEqual({ lastName: "Jones" });
  });

  it("detects birthDate change", () => {
    const result = getChangedFields(baseSnapshot, { ...baseSnapshot, birthDate: "2011-01-01" });
    expect(result).toEqual({ birthDate: "2011-01-01" });
  });

  it("detects sex change", () => {
    const result = getChangedFields(baseSnapshot, { ...baseSnapshot, sex: "male" });
    expect(result).toEqual({ sex: "male" });
  });

  it("detects isPublic change from false to true", () => {
    const result = getChangedFields(baseSnapshot, { ...baseSnapshot, isPublic: true });
    expect(result).toEqual({ isPublic: true });
  });

  it("detects clubs change", () => {
    const newClubs = [{ clubId: "eeeeeeee-0000-4000-8000-000000000001" }];
    const result = getChangedFields(baseSnapshot, { ...baseSnapshot, clubs: newClubs });
    expect(result).toEqual({ clubs: newClubs });
  });

  it("detects multiple changes at once", () => {
    const result = getChangedFields(baseSnapshot, {
      ...baseSnapshot,
      firstName: "Bob",
      sex: "male",
    });
    expect(result).toEqual({ firstName: "Bob", sex: "male" });
  });

  it("treats clubs as equal when same set regardless of order", () => {
    const clubA = { clubId: "aaaaaaaa-0000-4000-8000-000000000001" };
    const clubB = { otherClubName: "Dolphins" };
    const initial = { ...baseSnapshot, clubs: [clubA, clubB] };
    const updated = { ...baseSnapshot, clubs: [clubB, clubA] };
    expect(getChangedFields(initial, updated)).toBeNull();
  });
});

describe("mapPublicToggleApiResponse — enable direction", () => {
  it("returns idle on 200 (enable succeeded)", () => {
    expect(mapPublicToggleApiResponse(200, "enable").status).toBe("idle");
  });

  it("returns owner-only error on 403 (consent required to turn on)", () => {
    const result = mapPublicToggleApiResponse(403, "enable");
    expect(result.status).toBe("error");
    expect("message" in result && result.message).toMatch(/household owner/i);
    expect("message" in result && result.message).not.toMatch(/manager/i);
  });

  it("returns not-found error on 404", () => {
    const result = mapPublicToggleApiResponse(404, "enable");
    expect(result.status).toBe("error");
    expect("message" in result && result.message).toMatch(/not found/i);
  });

  it("returns generic error on 500", () => {
    const result = mapPublicToggleApiResponse(500, "enable");
    expect(result.status).toBe("error");
    expect("message" in result && result.message).toMatch(/something went wrong/i);
  });
});

describe("mapPublicToggleApiResponse — disable direction", () => {
  it("returns idle on 200 (turning off works)", () => {
    expect(mapPublicToggleApiResponse(200, "disable").status).toBe("idle");
  });

  it("returns owners-and-managers error on 403 (viewers can't change)", () => {
    const result = mapPublicToggleApiResponse(403, "disable");
    expect(result.status).toBe("error");
    expect("message" in result && result.message).toMatch(/managers/i);
  });
});

describe("mapApiResponse (EditSwimmerContent)", () => {
  it("returns unavailable-clubs error on 400", () => {
    const result = mapApiResponse(400, null);
    expect(result.status).toBe("error");
    expect("message" in result && result.message).toContain("no longer available");
  });

  it("returns permission error on 403 (viewers can't change)", () => {
    const result = mapApiResponse(403, null);
    expect(result.status).toBe("error");
    expect("message" in result && result.message).toMatch(/permission/i);
  });

  it("returns not-found error on 404", () => {
    const result = mapApiResponse(404, null);
    expect(result.status).toBe("error");
    expect("message" in result && result.message).toMatch(/not found/i);
  });

  it("maps 422 with Zod issues to field_errors", () => {
    const result = mapApiResponse(422, {
      error: "Validation failed",
      issues: [{ path: ["firstName"], message: "Required" }],
    });
    expect(result.status).toBe("field_errors");
    expect("errors" in result && result.errors["firstName"]).toBe("Required");
  });

  it("returns generic error on 500", () => {
    const result = mapApiResponse(500, null);
    expect(result.status).toBe("error");
    expect("message" in result && result.message).toMatch(/something went wrong/i);
  });
});
