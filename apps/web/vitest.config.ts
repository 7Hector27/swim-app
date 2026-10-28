import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // `server-only` throws by design outside RSC — fine for `next build`,
      // which catches stray client imports there, but tests need a no-op
      // or every file that touches a server module fails to load.
      "server-only": path.resolve(__dirname, "./src/__tests__/stubs/server-only.ts"),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/__tests__/setup.ts"],
  },
});
