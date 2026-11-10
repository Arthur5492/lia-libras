import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/server/**/*.test.ts"],
    // The API tests share one emulator, so the files must not run at the same time.
    fileParallelism: false,
    testTimeout: 30000,
  },
});
