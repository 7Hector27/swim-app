import { describe, expect, it } from "vitest";
import { LoginBodySchema } from "../schemas/auth";

describe("LoginBodySchema", () => {
  it("accepts valid credentials", () => {
    const result = LoginBodySchema.safeParse({
      email: "user@example.com",
      password: "secret123",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing email", () => {
    const result = LoginBodySchema.safeParse({ password: "secret123" });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid email format", () => {
    const result = LoginBodySchema.safeParse({
      email: "not-an-email",
      password: "secret123",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing password", () => {
    const result = LoginBodySchema.safeParse({ email: "user@example.com" });
    expect(result.success).toBe(false);
  });

  it("rejects an empty password", () => {
    const result = LoginBodySchema.safeParse({
      email: "user@example.com",
      password: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown extra fields", () => {
    const result = LoginBodySchema.safeParse({
      email: "user@example.com",
      password: "secret123",
      extra: "field",
    });
    expect(result.success).toBe(false);
  });
});
