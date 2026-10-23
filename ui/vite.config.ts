// Builds the page into ../harness/web/static, which the Python server serves.
// `npm run dev` serves it at http://localhost:5173 and passes API calls on to the
// Python server (port 8000, or HARNESS_PORT if set, e.g. HARNESS_PORT=8100 npm run dev).
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const target = `http://127.0.0.1:${process.env.HARNESS_PORT ?? '8000'}`
const api = ['/info', '/events', '/profile', '/settings', '/conversations', '/chat', '/stop', '/approve',
             '/provider', '/local-server', '/reset', '/compare', '/rerun', '/rewind', '/evals'] // matched by how an address starts: src/api/proxy.test.ts checks

export default defineConfig({
  base: '/',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../harness/web/static',
    emptyOutDir: true,
    assetsDir: 'assets',
    sourcemap: false,
    chunkSizeWarningLimit: 1000, // served from this computer, so one larger file is fine
  },
  server: {
    port: 5173,
    proxy: Object.fromEntries(api.map((path) => [path, { target, changeOrigin: true }])),
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
})
