import { defineConfig } from "vitest/config";
import { config as dotenvConfig } from "dotenv";
import { resolve } from "node:path";

dotenvConfig({ path: resolve(__dirname, ".env") });

export default defineConfig({
  test: {
    globals: true,
    include: ["src/__tests__/integration/**/*.integration.test.ts"],
    setupFiles: ["./src/__tests__/integration/setup.ts"],
    // Integration tests hit a real Supabase stack — they are slower and must
    // not run in parallel against the same DB.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
