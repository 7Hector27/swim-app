import type { NextConfig } from "next";
import path from "path";

// Fail the build early if any required NEXT_PUBLIC_* var is missing. The full
// Zod validation lives in src/lib/env.ts and runs again when the root layout
// renders; this check is a defensive pre-flight so build logs point directly
// at the missing variable instead of a cryptic render error.
const requiredPublicEnv = [
  "NEXT_PUBLIC_API_URL",
  "NEXT_PUBLIC_SITE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
] as const;

const isProductionBuild =
  process.env.NEXT_PHASE === "phase-production-build" || process.env.NODE_ENV === "production";

if (isProductionBuild) {
  const missing = requiredPublicEnv.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `Invalid web environment configuration:\n${missing
        .map((name) => `  - ${name} is required`)
        .join("\n")}`,
    );
  }
}

const config: NextConfig = {
  outputFileTracingRoot: path.join(__dirname, "../../"),
};

export default config;
