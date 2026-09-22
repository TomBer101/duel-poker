import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Like vitest.emulator.config.ts (real Firebase emulator via
// `firebase emulators:exec`), but for src/ui/ hook tests that also need
// jsdom + the React plugin for `renderHook`. Kept separate from that file
// rather than added to it, so a plain `src/net/` emulator test run never
// pays for jsdom/React it doesn't need.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": "/src" },
  },
  test: {
    globals: true,
    environment: "jsdom",
    include: ["src/ui/**/*.emulator.test.{ts,tsx}"],
    setupFiles: ["src/test/setup.ts"],
  },
});
