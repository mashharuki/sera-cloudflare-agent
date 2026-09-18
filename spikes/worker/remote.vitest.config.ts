import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "spikes/worker/{model-provider,privy-signing,external-apis,sse-isolation}.spike.test.ts",
    ],
    testTimeout: 90_000,
  },
});
