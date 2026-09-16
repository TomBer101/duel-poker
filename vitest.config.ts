import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Kept separate from vite.config.ts on purpose. Historically the Tailwind/React
// Vite plugins crashed Vitest's config bundler in this environment (the unsigned
// native rolldown binary is blocked by Windows Smart App Control, so Vite 8 /
// Vitest 4 fall back to the WASM engine). That crash no longer reproduces on the
// current Vite/Vitest, so `@vitejs/plugin-react` is loaded here for the JSX
// transform that component tests need. Tailwind is still NOT loaded: tests never
// assert on generated CSS, and leaving it out keeps the config surface minimal.
//
// If plugin loading regresses here again, the fallback is a plugin-free config
// with `esbuild: { jsx: "automatic", jsxImportSource: "react" }` — that gives the
// JSX transform without any plugin. Either way, do not move `test:` into
// vite.config.ts (that pulls the Tailwind plugin back into Vitest's config load).
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": "/src" },
  },
  test: {
    globals: true,
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    // Emulator-backed net/ tests need a running Firebase emulator (see
    // vitest.emulator.config.ts / `pnpm test:emulator`) and are excluded here
    // so plain `pnpm test` never fails for lack of one.
    exclude: [...configDefaults.exclude, "src/**/*.emulator.test.ts"],
    setupFiles: ["src/test/setup.ts"],
  },
});
