import { describe, expect, it } from "vitest";
import { isSafeReturnTo } from "../lib/isSafeReturnTo";

const ORIGIN = "http://localhost:3000";

describe("isSafeReturnTo", () => {
  it("accepts root path", () => {
    expect(isSafeReturnTo("/", ORIGIN)).toBe(true);
  });

  it("accepts normal relative path", () => {
    expect(isSafeReturnTo("/invite/abc", ORIGIN)).toBe(true);
  });

  it("rejects protocol-relative URL", () => {
    expect(isSafeReturnTo("//evil.com", ORIGIN)).toBe(false);
  });

  it("rejects absolute URL", () => {
    expect(isSafeReturnTo("https://evil.com", ORIGIN)).toBe(false);
  });

  it("rejects raw backslash", () => {
    expect(isSafeReturnTo("/\\evil.com", ORIGIN)).toBe(false);
  });

  it("rejects percent-encoded backslash", () => {
    expect(isSafeReturnTo("/%5Cevil.com", ORIGIN)).toBe(false);
  });

  it("rejects value with control character", () => {
    expect(isSafeReturnTo("/path\x00inject", ORIGIN)).toBe(false);
  });

  it("rejects value with newline", () => {
    expect(isSafeReturnTo("/path\ninjected-header: x", ORIGIN)).toBe(false);
  });

  it("accepts path with query string", () => {
    expect(isSafeReturnTo("/invite/abc?foo=bar", ORIGIN)).toBe(true);
  });
});
