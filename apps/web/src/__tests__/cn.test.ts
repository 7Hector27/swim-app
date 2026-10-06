import { describe, it, expect } from "vitest";
import { cn } from "../lib/cn";

describe("cn", () => {
  it("joins non-empty class strings", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("filters out falsy values", () => {
    expect(cn("foo", false, null, undefined, "bar")).toBe("foo bar");
  });

  it("returns empty string when all values are falsy", () => {
    expect(cn(false, null, undefined)).toBe("");
  });
});
