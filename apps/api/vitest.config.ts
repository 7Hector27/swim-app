import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ["./src/__tests__/setup.ts"],
    // Integration tests require a live Supabase stack — they're run via the
    // separate `vitest.integration.config.ts`.
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "src/__tests__/integration/**",
    ],
  },
});
