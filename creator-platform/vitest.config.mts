import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    // Verification runs on a shared production host. Bounding the pool keeps
    // interaction tests deterministic when unrelated jobs consume CPU.
    maxWorkers: 2,
  },
});
