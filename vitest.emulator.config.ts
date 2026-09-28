import { defineConfig } from "vitest/config";

// Tests that talk to a real Firebase Realtime Database / Auth emulator (room
// creation, event sync, security rules). Run via `pnpm test:emulator`, which
// wraps this in `firebase emulators:exec` so the emulator is up for the
// duration of the run and torn down after. No jsdom/React plugin needed here
// — these tests exercise src/net/ directly, not components.
export default defineConfig({
  resolve: {
    alias: { "@": "/src" },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.emulator.test.ts"],
    // jsdom hook tests run under vitest.emulator.jsdom.config.ts (test:emulator:ui).
    exclude: ["src/ui/**", "node_modules/**"],
  },
});
