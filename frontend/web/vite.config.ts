/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  optimizeDeps: {
    // latex.js dynamically require()s its documentclasses/ and packages/ dirs,
    // which contain `.keep` placeholder files esbuild can't load while
    // pre-bundling in dev. Treat `.keep` as empty so dep optimization succeeds
    // (the prod rollup build already handles this).
    esbuildOptions: { loader: { '.keep': 'empty' } },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    // During `npm run dev` outside docker, proxy /api to the local backend so
    // the same fetch URLs work in dev and behind nginx in prod.
    proxy: {
      '/api': 'http://localhost:8080',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
