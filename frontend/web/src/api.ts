// Thin fetch wrapper. The base URL is intentionally relative — nginx (in prod)
// or the Vite dev proxy (in `npm run dev`) reverse-proxies /api to the
// backend, so the browser sees same-origin requests and we never have to
// thread an API_URL env var through the build.

export const API_BASE = '/api/v1'

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

// `request` performs the HTTP call, attaches the bearer token if provided,
// and converts non-2xx responses into APIErrorImpl so callers can branch on
// `.status` / `.code` without repeating envelope-parsing.
export async function request<T>(
    path: string,
    opts: { method?: string; body?: unknown; token?: string | null } = {},
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
            code?: string;
            error?: string;
            fields?: Record<string, string>;
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
