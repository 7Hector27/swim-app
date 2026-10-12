import { describe, expect, it } from "vitest";
import { ChangeRoleBodySchema, RenameHouseholdBodySchema, TransferOwnershipBodySchema } from "../schemas/households";

describe("RenameHouseholdBodySchema", () => {
  it("accepts a valid name", () => {
    expect(RenameHouseholdBodySchema.safeParse({ name: "Smith Family" }).success).toBe(true);
  });

  it("rejects empty string", () => {
    expect(RenameHouseholdBodySchema.safeParse({ name: "" }).success).toBe(false);
  });

  it("rejects name longer than 50 characters", () => {
    expect(RenameHouseholdBodySchema.safeParse({ name: "A".repeat(51) }).success).toBe(false);
  });

  it("accepts name of exactly 50 characters", () => {
    expect(RenameHouseholdBodySchema.safeParse({ name: "A".repeat(50) }).success).toBe(true);
  });
});

describe("ChangeRoleBodySchema", () => {
  it("accepts manager", () => {
    expect(ChangeRoleBodySchema.safeParse({ role: "manager" }).success).toBe(true);
  });

  it("accepts viewer", () => {
    expect(ChangeRoleBodySchema.safeParse({ role: "viewer" }).success).toBe(true);
  });

  it("rejects owner", () => {
    expect(ChangeRoleBodySchema.safeParse({ role: "owner" }).success).toBe(false);
  });

  it("rejects unknown role", () => {
    expect(ChangeRoleBodySchema.safeParse({ role: "admin" }).success).toBe(false);
  });
});

describe("TransferOwnershipBodySchema", () => {
  it("accepts a valid UUID", () => {
    expect(
      TransferOwnershipBodySchema.safeParse({ newOwnerProfileId: "00000000-0000-4000-8000-000000000000" }).success,
    ).toBe(true);
  });

  it("rejects a non-UUID string", () => {
    expect(TransferOwnershipBodySchema.safeParse({ newOwnerProfileId: "not-a-uuid" }).success).toBe(false);
  });

  it("rejects missing field", () => {
    expect(TransferOwnershipBodySchema.safeParse({}).success).toBe(false);
  });
});
