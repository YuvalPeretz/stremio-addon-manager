import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["packages/*/src/**/*.test.ts"],
    // hookTimeout must not be capped by testTimeout (Vitest 2.x applies testTimeout as
    // an upper bound on hook timeouts when both are set).  Unit tests finish in <2 s so
    // the Vitest default testTimeout (5 s) is adequate.  The player-simulation describe
    // sets its own per-suite timeout via { timeout: SUITE_TIMEOUT_MS }.
    hookTimeout: 120_000,
  },
});
