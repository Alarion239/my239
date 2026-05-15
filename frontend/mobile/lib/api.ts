// Thin HTTP wrapper, mobile flavour. The web app proxies /api via Vite; on
// device there's no proxy — we read an explicit backend URL from
// app.json's `extra.backendURL` (or the EXPO_PUBLIC_BACKEND_URL env so
// CI / personal dev setups can override without committing).

import Constants from 'expo-constants'

const fromEnv = process.env.EXPO_PUBLIC_BACKEND_URL?.trim()
const fromConfig = (Constants.expoConfig?.extra as {backendURL?: string} | undefined)?.backendURL?.trim()

export const BACKEND_URL = (fromEnv || fromConfig || 'http://localhost:8080').replace(/\/$/, '')
export const API_BASE = `${BACKEND_URL}/api/v1`

export interface APIError {
    status: number
    code?: string
    message: string
    fields?: Record<string, string>
    traceId?: string
}

export class APIErrorImpl extends Error implements APIError {
    status: number
    code?: string
    fields?: Record<string, string>
    traceId?: string

    constructor(init: APIError) {
        super(init.message)
        this.status = init.status
        this.code = init.code
        this.fields = init.fields
        this.traceId = init.traceId
    }
}

export async function request<T>(
    path: string,
    opts: {method?: string; body?: unknown; token?: string | null} = {},
): Promise<T> {
    const headers: Record<string, string> = {}
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
    if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`

    const res = await fetch(`${API_BASE}${path}`, {
        method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    })

    if (res.status === 204) return undefined as T

    const text = await res.text()
    const parsed = text ? safeJSON(text) : null

    if (!res.ok) {
        const env = parsed as {
            code?: string
            error?: string
            fields?: Record<string, string>
            trace_id?: string
        } | null
        throw new APIErrorImpl({
            status: res.status,
            code: env?.code,
            message: env?.error ?? `request failed (${res.status})`,
            fields: env?.fields,
            traceId: env?.trace_id,
        })
    }

    return (parsed as T) ?? (undefined as T)
}

// pingHealth is the bootstrap connectivity probe — the home screen calls
// it on mount to confirm we can reach the backend. /healthz is the
// liveness endpoint and doesn't require auth.
export async function pingHealth(): Promise<boolean> {
    try {
        const res = await fetch(`${BACKEND_URL}/healthz`)
        return res.ok
    } catch {
        return false
    }
}

function safeJSON(s: string): unknown {
    try {
        return JSON.parse(s)
    } catch {
        return null
    }
}
