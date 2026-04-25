import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'

// React Native for Web is opted into via two switches:
//   1. resolve.alias rewrites every `react-native` import to `react-native-web`
//   2. resolve.extensions adds `.web.tsx` / `.web.ts` so any future
//      web-specific overrides win over a generic `.tsx`.
//
// `define` shims are required because react-native-web reads `__DEV__`
// (RN-style) and `process.env.NODE_ENV` at module init.
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            'react-native': 'react-native-web',
        },
        extensions: ['.web.tsx', '.web.ts', '.tsx', '.ts', '.web.jsx', '.web.js', '.jsx', '.js'],
    },
    define: {
        __DEV__: JSON.stringify(process.env.NODE_ENV !== 'production'),
        'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
    },
    server: {
        host: '0.0.0.0',
        port: 5173,
        // During `npm run dev` outside docker, proxy /api to the local backend
        // so the same fetch URLs work in dev and behind nginx in prod.
        proxy: {
            '/api': 'http://localhost:8080',
        },
    },
})
