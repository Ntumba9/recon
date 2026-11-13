import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // The integration suites share one real Postgres database and each
    // resets core tables (ReconciliationRun, FindingRecord, ...) at the
    // start of its own run. Running test files in parallel lets one
    // file's reset wipe data another file's tests are mid-way through
    // relying on, so files run sequentially; tests within a single file
    // already run sequentially by default regardless.
    fileParallelism: false,
  },
});
