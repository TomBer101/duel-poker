import { defineConfig } from "vitest/config";

// Deliberately plugin-free: the Tailwind/React Vite plugins crash Vitest's
// config bundler in this environment (unsigned native rolldown binary is
// blocked by Windows Smart App Control, and the wasm fallback mishandles the
// config entry path). Engine/AI/crypto tests need no plugins. When UI tests
// arrive, add `@vitejs/plugin-react` here or move to a projects setup.
export default defineConfig({
  resolve: {
    alias: { "@": "/src" },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    // setupFiles (jest-dom) will be re-added when UI component tests land.
  },
});
