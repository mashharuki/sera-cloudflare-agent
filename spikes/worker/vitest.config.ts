import { resolve } from "node:path";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: resolve(import.meta.dirname, "../.."),
  plugins: [
    cloudflareTest({
      wrangler: { configPath: resolve(import.meta.dirname, "wrangler.jsonc") },
    }),
  ],
  test: {
    include: [
      resolve(import.meta.dirname, "strands-worker.spike.test.ts"),
      resolve(import.meta.dirname, "idempotency-concurrency.spike.test.ts"),
    ],
  },
});
