import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    setupFiles: ["tests/setup.ts"],
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
