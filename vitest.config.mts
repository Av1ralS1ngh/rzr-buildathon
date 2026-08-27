import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": `${import.meta.dirname}/src`,
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    fileParallelism: false,
    coverage: {
      include: ["src/lib/**/*.ts", "src/app/api/**/*.ts"],
    },
  },
});
