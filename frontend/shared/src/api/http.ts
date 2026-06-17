// Platform-agnostic HTTP wrapper. `fetch`, `Response`, and `BodyInit` are web
// standards present in both browsers and React Native, so this file is
// identical across platforms. It must not touch window/document/localStorage —
// the wire contract (request shape + error envelope) is all it knows.

import type { ErrorEnvelope } from '../types'

export interface APIError {
  status: number
  code?: string
  message: string
  fields?: Record<string, string>
  traceId?: string
}

// APIErrorImpl is thrown for every non-2xx response so callers can branch on
// `.status` / `.code` without re-parsing the envelope each time.
export class APIErrorImpl extends Error implements APIError {
  status: number
  code?: string
  fields?: Record<string, string>
  traceId?: string

  constructor(init: APIError) {
    super(init.message)
    this.name = 'APIError'
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
  // Extra headers merged on top of the built ones (Content-Type, Authorization).
  // Used for cross-cutting headers like admin act-as impersonation.
  headers?: Record<string, string>
}

// request performs a JSON HTTP call against `${baseURL}${path}`, attaches a
// bearer token when provided, and converts non-2xx responses into
// APIErrorImpl. Each platform supplies its own baseURL so this stays free of
// any build/runtime config.
export async function request<T>(
  baseURL: string,
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {}
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`
  if (opts.headers) Object.assign(headers, opts.headers)

  const res = await fetch(`${baseURL}${path}`, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })

  if (res.status === 204) return undefined as T

  const text = await res.text()
  const parsed = text ? safeJSON(text) : null

  if (!res.ok) {
    const env = parsed as ErrorEnvelope | null
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
