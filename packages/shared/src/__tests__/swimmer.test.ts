import { describe, it, expect } from "vitest";
import {
  ClubSchema,
  GuardianSchema,
  SwimmerBaseSchema,
  SwimmerClubBaseSchema,
  SwimmerClubSchema,
  SwimmerSchema,
} from "../schemas/swimmer";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const swimmerBase = {
  id: "00000000-0000-0000-0000-000000000001",
  firstName: "Alex",
  lastName: "Rivera",
  birthDate: "2015-03-12",
  sex: "female" as const,
  archivedAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const consentFields = {
  publicConsentAt: "2026-06-01T10:00:00Z",
  publicConsentBy: "00000000-0000-0000-0000-000000000002",
};

const swimmerClubBase = {
  id: "00000000-0000-0000-0000-000000000010",
  swimmerId: "00000000-0000-0000-0000-000000000001",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

// ── SwimmerBaseSchema ─────────────────────────────────────────────────────────

describe("SwimmerBaseSchema", () => {
  it("accepts isPublic true with null consent fields (no refine on base)", () => {
    const result = SwimmerBaseSchema.safeParse({
      ...swimmerBase,
      isPublic: true,
      publicConsentAt: null,
      publicConsentBy: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty firstName", () => {
    const result = SwimmerBaseSchema.safeParse({
      ...swimmerBase,
      firstName: "",
      isPublic: false,
      publicConsentAt: null,
      publicConsentBy: null,
    });
    expect(result.success).toBe(false);
  });

  it("rejects whitespace-only firstName", () => {
    const result = SwimmerBaseSchema.safeParse({
      ...swimmerBase,
      firstName: "   ",
      isPublic: false,
      publicConsentAt: null,
      publicConsentBy: null,
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty lastName", () => {
    const result = SwimmerBaseSchema.safeParse({
      ...swimmerBase,
      lastName: "",
      isPublic: false,
      publicConsentAt: null,
      publicConsentBy: null,
    });
    expect(result.success).toBe(false);
  });

  it("rejects whitespace-only lastName", () => {
    const result = SwimmerBaseSchema.safeParse({
      ...swimmerBase,
      lastName: "   ",
      isPublic: false,
      publicConsentAt: null,
      publicConsentBy: null,
    });
    expect(result.success).toBe(false);
  });
});

// ── SwimmerSchema ─────────────────────────────────────────────────────────────

describe("SwimmerSchema", () => {
  describe("public consent rule", () => {
    it("accepts isPublic false with null consent fields", () => {
      const result = SwimmerSchema.safeParse({
        ...swimmerBase,
        isPublic: false,
        publicConsentAt: null,
        publicConsentBy: null,
      });
      expect(result.success).toBe(true);
    });

    it("accepts isPublic true when both consent fields are present", () => {
      const result = SwimmerSchema.safeParse({
        ...swimmerBase,
        isPublic: true,
        ...consentFields,
      });
      expect(result.success).toBe(true);
    });

    it("rejects isPublic true when publicConsentAt is null", () => {
      const result = SwimmerSchema.safeParse({
        ...swimmerBase,
        isPublic: true,
        publicConsentAt: null,
        publicConsentBy: consentFields.publicConsentBy,
      });
      expect(result.success).toBe(false);
    });

    it("rejects isPublic true when publicConsentBy is null", () => {
      const result = SwimmerSchema.safeParse({
        ...swimmerBase,
        isPublic: true,
        publicConsentAt: consentFields.publicConsentAt,
        publicConsentBy: null,
      });
      expect(result.success).toBe(false);
    });

    it("rejects isPublic true when both consent fields are null", () => {
      const result = SwimmerSchema.safeParse({
        ...swimmerBase,
        isPublic: true,
        publicConsentAt: null,
        publicConsentBy: null,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.path).toContain("publicConsentAt");
      }
    });
  });
});

// ── GuardianSchema ────────────────────────────────────────────────────────────

describe("GuardianSchema", () => {
  it("accepts a valid guardian", () => {
    const result = GuardianSchema.safeParse({
      profileId: "00000000-0000-0000-0000-000000000002",
      swimmerId: "00000000-0000-0000-0000-000000000001",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    expect(result.success).toBe(true);
  });
});

// ── ClubSchema ────────────────────────────────────────────────────────────────

describe("ClubSchema", () => {
  it("accepts an active club", () => {
    const result = ClubSchema.safeParse({
      id: "00000000-0000-0000-0000-000000000020",
      name: "Lakeside Swim Club",
      isActive: true,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    expect(result.success).toBe(true);
  });

  it("accepts an inactive club", () => {
    const result = ClubSchema.safeParse({
      id: "00000000-0000-0000-0000-000000000021",
      name: "Old Club",
      isActive: false,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    expect(result.success).toBe(true);
  });
});

// ── SwimmerClubSchema ─────────────────────────────────────────────────────────

describe("SwimmerClubBaseSchema", () => {
  it("accepts both clubId and otherClubName null (no refine on base)", () => {
    const result = SwimmerClubBaseSchema.safeParse({
      ...swimmerClubBase,
      clubId: null,
      otherClubName: null,
    });
    expect(result.success).toBe(true);
  });
});

describe("SwimmerClubSchema", () => {
  it("accepts club only (clubId set, otherClubName null)", () => {
    const result = SwimmerClubSchema.safeParse({
      ...swimmerClubBase,
      clubId: "00000000-0000-0000-0000-000000000020",
      otherClubName: null,
    });
    expect(result.success).toBe(true);
  });

  it("accepts other only (clubId null, otherClubName set)", () => {
    const result = SwimmerClubSchema.safeParse({
      ...swimmerClubBase,
      clubId: null,
      otherClubName: "Valley Aquatics",
    });
    expect(result.success).toBe(true);
  });

  it("rejects both set", () => {
    const result = SwimmerClubSchema.safeParse({
      ...swimmerClubBase,
      clubId: "00000000-0000-0000-0000-000000000020",
      otherClubName: "Valley Aquatics",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toContain("clubId");
    }
  });

  it("rejects neither set", () => {
    const result = SwimmerClubSchema.safeParse({
      ...swimmerClubBase,
      clubId: null,
      otherClubName: null,
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty otherClubName", () => {
    const result = SwimmerClubSchema.safeParse({
      ...swimmerClubBase,
      clubId: null,
      otherClubName: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects whitespace-only otherClubName", () => {
    const result = SwimmerClubSchema.safeParse({
      ...swimmerClubBase,
      clubId: null,
      otherClubName: "   ",
    });
    expect(result.success).toBe(false);
  });
});
