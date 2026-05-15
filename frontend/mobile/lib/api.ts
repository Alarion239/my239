// Mobile-specific wiring around the shared HTTP wrapper. The backend
// URL is read from app.json's `extra.backendURL` (or the env override
// EXPO_PUBLIC_BACKEND_URL) because mobile devices can't use the web's
// /api proxy. iOS simulator can use http://localhost:8080; a physical
// iPhone needs the dev machine's LAN IP.

import Constants from 'expo-constants'
import {
    APIErrorImpl,
    request as sharedRequest,
    type APIError,
    type RequestOptions,
} from '@my239/shared/api/http'

export {APIErrorImpl}
export type {APIError, RequestOptions}

const fromEnv = process.env.EXPO_PUBLIC_BACKEND_URL?.trim()
const fromConfig = (Constants.expoConfig?.extra as {backendURL?: string} | undefined)?.backendURL?.trim()

export const BACKEND_URL = (fromEnv || fromConfig || 'http://localhost:8080').replace(/\/$/, '')
export const API_BASE = `${BACKEND_URL}/api/v1`

export function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    return sharedRequest<T>(API_BASE, path, opts)
}

// pingHealth is the bootstrap connectivity probe — the home screen
// calls it on mount to confirm we can reach the backend. /healthz is
// the liveness endpoint and doesn't require auth.
export async function pingHealth(): Promise<boolean> {
    try {
        const res = await fetch(`${BACKEND_URL}/healthz`)
        return res.ok
    } catch {
        return false
    }
}
