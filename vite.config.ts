import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
// Test config lives in vitest.config.ts (kept separate so Vitest can load a
// plugin-free config — the Tailwind/React plugins tripped Vitest's config
// bundler in this environment).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': '/src',
    }
  },
})
