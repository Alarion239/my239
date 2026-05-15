// Mobile auth context. Mirrors web's auth.tsx behaviour (login →
// access+refresh tokens → 401 triggers refresh → retry once) but stores
// tokens in expo-secure-store instead of localStorage. Anything that
// would touch the DOM lives in web; the shared HTTP wrapper is the only
// non-React-Native dependency this file pulls.

import * as SecureStore from 'expo-secure-store'
import {createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode} from 'react'
import {
    APIErrorImpl,
    request as sharedRequest,
    type AuthedFetch,
    type AuthedFetchRaw,
    type AuthedRawOpts,
} from '@my239/shared/api/http'
import {API_BASE, BACKEND_URL} from './api'

// User mirrors the backend's user row (auth.go GetUserByID response).
// Kept inline so this file has no cross-package coupling beyond shared.
export interface User {
    id: number
    username: string
    first_name: string
    middle_name?: string | null
    last_name: string
    is_admin: boolean
    created_at: string
}

interface TokenPair {
    access: string
    refresh: string
}

export interface RegisterArgs {
    username: string
    password: string
    invitation_token: string
    first_name: string
    middle_name?: string
    last_name?: string
}

export interface AuthState {
    user: User | null
    loading: boolean
    login(username: string, password: string): Promise<void>
    register(args: RegisterArgs): Promise<void>
    logout(): Promise<void>
    authedFetch: AuthedFetch
    authedFetchRaw: AuthedFetchRaw
}

// expo-secure-store stores values as strings; we serialize the token
// pair as JSON. The key namespace mirrors the web key so it's easy to
// reason about across platforms even though they share nothing.
const STORAGE_KEY = 'my239.tokens'

async function loadTokens(): Promise<TokenPair | null> {
    try {
        const raw = await SecureStore.getItemAsync(STORAGE_KEY)
        return raw ? (JSON.parse(raw) as TokenPair) : null
    } catch {
        return null
    }
}

async function saveTokens(t: TokenPair | null): Promise<void> {
    if (t) {
        await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(t))
    } else {
        await SecureStore.deleteItemAsync(STORAGE_KEY)
    }
}

export const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({children}: {children: ReactNode}) {
    const [tokens, setTokens] = useState<TokenPair | null>(null)
    const [user, setUser] = useState<User | null>(null)
    const [loading, setLoading] = useState(true)

    // Persist token pair changes to secure storage in one place.
    useEffect(() => {
        saveTokens(tokens).catch(() => undefined)
    }, [tokens])

    // tryRefresh swaps an expired access token for a fresh pair.
    // Returns the new access token on success, or null if the refresh
    // token is also dead — in which case the caller drops to the
    // logged-out state.
    const tryRefresh = useCallback(async (): Promise<string | null> => {
        const current = await loadTokens()
        if (!current) return null
        try {
            const res = await sharedRequest<{access_token: string; refresh_token: string}>(
                API_BASE,
                '/auth/refresh',
                {body: {refresh_token: current.refresh}},
            )
            const next: TokenPair = {access: res.access_token, refresh: res.refresh_token}
            setTokens(next)
            return next.access
        } catch {
            setTokens(null)
            setUser(null)
            return null
        }
    }, [])

    // authedFetch wraps shared `request` with automatic 401 → refresh
    // → retry-once. The token lookup goes through loadTokens() rather
    // than `tokens` state so async refreshes don't race with
    // re-renders.
    const authedFetch: AuthedFetch = useCallback(async <T,>(
        path: string,
        opts: {method?: string; body?: unknown} = {},
    ): Promise<T> => {
        const current = await loadTokens()
        try {
            return await sharedRequest<T>(API_BASE, path, {...opts, token: current?.access})
        } catch (e) {
            if (e instanceof APIErrorImpl && e.status === 401) {
                const fresh = await tryRefresh()
                if (fresh) return await sharedRequest<T>(API_BASE, path, {...opts, token: fresh})
            }
            throw e
        }
    }, [tryRefresh])

    // authedFetchRaw is the lower-level cousin — returns the raw
    // Response so blob bodies / multipart uploads / redirect-following
    // can be handled by the caller. Same 401 → refresh → retry policy.
    const authedFetchRaw: AuthedFetchRaw = useCallback(async (
        path: string,
        opts: AuthedRawOpts = {},
    ): Promise<Response> => {
        const doFetch = (token?: string | null) => {
            const headers: Record<string, string> = {...(opts.headers ?? {})}
            if (token) headers['Authorization'] = `Bearer ${token}`
            return fetch(`${API_BASE}${path}`, {
                method: opts.method ?? 'GET',
                headers,
                body: opts.body ?? undefined,
                redirect: opts.redirect ?? 'follow',
            })
        }
        const current = await loadTokens()
        let res = await doFetch(current?.access)
        if (res.status === 401) {
            const fresh = await tryRefresh()
            if (fresh) res = await doFetch(fresh)
        }
        if (!res.ok && res.type !== 'opaqueredirect') {
            const text = await res.text().catch(() => '')
            const env = text ? safeParse(text) : null
            throw new APIErrorImpl({
                status: res.status,
                code: env?.code,
                message: env?.error ?? `request failed (${res.status})`,
                fields: env?.fields,
                traceId: env?.trace_id,
            })
        }
        return res
    }, [tryRefresh])

    const fetchMe = useCallback(async () => {
        try {
            const me = await authedFetch<User>('/auth/me')
            setUser(me)
        } catch {
            setUser(null)
            setTokens(null)
        } finally {
            setLoading(false)
        }
    }, [authedFetch])

    // On mount: hydrate tokens from secure store; if present, fetch
    // the user record so the rest of the app can branch on role.
    useEffect(() => {
        loadTokens().then(t => {
            setTokens(t)
            if (t) {
                void fetchMe()
            } else {
                setLoading(false)
            }
        })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const login = useCallback(async (username: string, password: string) => {
        const res = await sharedRequest<{access_token: string; refresh_token: string; user: User}>(
            API_BASE,
            '/auth/login',
            {body: {username, password}},
        )
        setTokens({access: res.access_token, refresh: res.refresh_token})
        setUser(res.user)
    }, [])

    const register = useCallback(async (args: RegisterArgs) => {
        const res = await sharedRequest<{access_token: string; refresh_token: string; user: User}>(
            API_BASE,
            '/auth/register',
            {body: args},
        )
        setTokens({access: res.access_token, refresh: res.refresh_token})
        setUser(res.user)
    }, [])

    const logout = useCallback(async () => {
        const current = await loadTokens()
        if (current) {
            try {
                await sharedRequest(API_BASE, '/auth/logout', {
                    body: {refresh_token: current.refresh},
                    token: current.access,
                })
            } catch {
                // best-effort; clear local state regardless
            }
        }
        setTokens(null)
        setUser(null)
    }, [])

    const value = useMemo<AuthState>(
        () => ({user, loading, login, register, logout, authedFetch, authedFetchRaw}),
        [user, loading, login, register, logout, authedFetch, authedFetchRaw],
    )

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
    const v = useContext(AuthContext)
    if (!v) throw new Error('useAuth must be used inside <AuthProvider>')
    return v
}

// Used by the dev/debug screens that want to display the configured
// backend URL alongside the auth state.
export {BACKEND_URL}

function safeParse(s: string): {code?: string; error?: string; fields?: Record<string, string>; trace_id?: string} | null {
    try {
        return JSON.parse(s)
    } catch {
        return null
    }
}
