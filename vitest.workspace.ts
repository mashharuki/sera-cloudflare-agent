import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "apps/backend/vitest.config.ts",
      "apps/frontend/vite.config.ts",
      "packages/api-spec",
      "packages/shared",
      "spikes/worker",
    ],
  },
});
