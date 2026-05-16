/// <reference types="vitest" />
import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
    plugins: [react(), tailwindcss()],
    server: {
        host: '0.0.0.0',
        port: 5173,
        // During `npm run dev` outside docker, proxy /api to the local backend
        // so the same fetch URLs work in dev and behind nginx in prod.
        proxy: {
            '/api': 'http://localhost:8080',
        },
    },
    test: {
        environment: 'jsdom',
        globals: true,
        setupFiles: ['./src/test/setup.ts'],
        css: false,
        // Restrict to source tests; tsc -b emits sibling .js files which would
        // otherwise be picked up and run as a stale duplicate suite.
        include: ['src/**/*.test.{ts,tsx}'],
    },
})
