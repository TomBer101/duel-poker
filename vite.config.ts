import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    // Enables global test API methods like describe, it, expect without manual imports
    globals: true, 
    // Emulates a browser environment in Node.js via jsdom
    environment: 'jsdom',
    // Specifies the path to your initialization script
    setupFiles: './src/test/setup.ts', 
  },
})
