// Platform-agnostic HTTP wrapper. The web client proxies /api/v1 to the
// backend via nginx / Vite, so its base URL is relative; the mobile
// client points at the dev machine's LAN IP. Each platform supplies its
// own base URL when calling request(), keeping this file free of any
// build/runtime-specific config.
//
// fetch is available natively in both web and React Native, so the
// implementation here is identical across platforms — the parameter
// shape and error envelope are the wire contract with the backend.

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

export interface RequestOptions {
    method?: string
    body?: unknown
    token?: string | null
}

// request performs the HTTP call, attaches a bearer token if provided,
// and converts non-2xx responses into APIErrorImpl so callers can
// branch on `.status` / `.code` without repeating envelope-parsing.
export async function request<T>(
    baseURL: string,
    path: string,
    opts: RequestOptions = {},
): Promise<T> {
    const headers: Record<string, string> = {}
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
    if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`

    const res = await fetch(`${baseURL}${path}`, {
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

function safeJSON(s: string): unknown {
    try {
        return JSON.parse(s)
    } catch {
        return null
    }
}

// AuthedFetch is the higher-level surface a domain client expects: a
// pre-bound `request<T>` that knows the base URL AND the current auth
// token. Each platform wraps the lower-level `request` here with its
// own token-storage and refresh logic, then passes the resulting
// `authedFetch` down to homework / series / etc. clients.
export type AuthedFetch = <T>(path: string, opts?: {method?: string; body?: unknown}) => Promise<T>

// AuthedRawOpts is the type used by raw (non-JSON) request paths such
// as multipart uploads or blob downloads. Kept platform-neutral by
// referencing only the standard fetch globals.
export interface AuthedRawOpts {
    method?: string
    body?: BodyInit | null
    headers?: Record<string, string>
    redirect?: 'follow' | 'error' | 'manual'
}

export type AuthedFetchRaw = (path: string, opts?: AuthedRawOpts) => Promise<Response>
