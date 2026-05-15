// Web-specific wiring around the shared HTTP wrapper. The shared
// `request` is fully platform-agnostic; the web client pins the base
// URL to /api/v1 so nginx (prod) or the Vite dev proxy (`npm run dev`)
// reverse-proxies it to the backend without threading any env var
// through the build. Mobile uses a different base URL (the dev machine's
// LAN IP) — see frontend/mobile/lib/api.ts.

import {
    APIErrorImpl,
    request as sharedRequest,
    type APIError,
    type RequestOptions,
} from '@my239/shared/api/http'

export {APIErrorImpl}
export type {APIError, RequestOptions}

export const API_BASE = '/api/v1'

export function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    return sharedRequest<T>(API_BASE, path, opts)
}
