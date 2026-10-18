import { describe, expect, it } from "vitest";
import { EnvValidationError, parsePublicEnv } from "@/lib/env";

const base = {
  NEXT_PUBLIC_API_URL: "https://api.example.com",
  NEXT_PUBLIC_SITE_URL: "https://app.example.com",
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "anon-key",
};

describe("parsePublicEnv", () => {
  it("accepts a complete env", () => {
    const env = parsePublicEnv(base);
    expect(env.apiUrl).toBe("https://api.example.com");
    expect(env.siteUrl).toBe("https://app.example.com");
    expect(env.supabaseUrl).toBe("https://project.supabase.co");
    expect(env.supabasePublishableKey).toBe("anon-key");
  });

  it("fails with a clear message when NEXT_PUBLIC_API_URL is missing", () => {
    const raw = { ...base } as Record<string, string>;
    delete raw.NEXT_PUBLIC_API_URL;
    let caught: unknown;
    try {
      parsePublicEnv(raw);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(EnvValidationError);
    expect((caught as EnvValidationError).message).toMatch(/NEXT_PUBLIC_API_URL/);
  });

  it("fails with a clear message when NEXT_PUBLIC_SUPABASE_URL is missing", () => {
    const raw = { ...base } as Record<string, string>;
    delete raw.NEXT_PUBLIC_SUPABASE_URL;
    expect(() => parsePublicEnv(raw)).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("fails with a clear message when NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing", () => {
    const raw = { ...base } as Record<string, string>;
    delete raw.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    expect(() => parsePublicEnv(raw)).toThrow(/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
  });

  it("fails when NEXT_PUBLIC_SITE_URL is missing", () => {
    const raw = { ...base } as Record<string, string>;
    delete raw.NEXT_PUBLIC_SITE_URL;
    expect(() => parsePublicEnv(raw)).toThrow(/NEXT_PUBLIC_SITE_URL/);
  });

  it("rejects a non-URL NEXT_PUBLIC_API_URL", () => {
    expect(() => parsePublicEnv({ ...base, NEXT_PUBLIC_API_URL: "not-a-url" })).toThrow(
      /NEXT_PUBLIC_API_URL/,
    );
  });

  it("names every failing variable in one error", () => {
    const raw = {
      NEXT_PUBLIC_API_URL: "",
      NEXT_PUBLIC_SITE_URL: "",
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
    };
    let caught: unknown;
    try {
      parsePublicEnv(raw);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(EnvValidationError);
    const message = (caught as EnvValidationError).message;
    expect(message).toMatch(/NEXT_PUBLIC_API_URL/);
    expect(message).toMatch(/NEXT_PUBLIC_SITE_URL/);
    expect(message).toMatch(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(message).toMatch(/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
  });
});
