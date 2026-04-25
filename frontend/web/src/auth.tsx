import {createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode} from 'react'
import {request, APIErrorImpl} from './api'

// Auth state held in a React context. We persist the token pair in
// localStorage so a refresh keeps the user signed in; the user record itself
// is re-fetched from /auth/me on mount because admin status (and other
// fields) may have changed server-side.

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

interface AuthState {
    user: User | null
    loading: boolean

    login(username: string, password: string): Promise<void>

    register(args: RegisterArgs): Promise<void>

    logout(): Promise<void>

    authedFetch<T>(path: string, opts?: { method?: string; body?: unknown }): Promise<T>
}

export interface RegisterArgs {
    username: string
    password: string
    invitation_token: string
    first_name: string
    middle_name?: string
    last_name?: string
}

const STORAGE_KEY = 'my239.tokens'

const Ctx = createContext<AuthState | null>(null)

function loadTokens(): TokenPair | null {
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        return raw ? (JSON.parse(raw) as TokenPair) : null
    } catch {
        return null
    }
}

function saveTokens(t: TokenPair | null) {
    if (t) localStorage.setItem(STORAGE_KEY, JSON.stringify(t))
    else localStorage.removeItem(STORAGE_KEY)
}

export function AuthProvider({children}: { children: ReactNode }) {
    const [tokens, setTokens] = useState<TokenPair | null>(() => loadTokens())
    const [user, setUser] = useState<User | null>(null)
    const [loading, setLoading] = useState<boolean>(!!tokens)

    // Persist token pair changes to storage in one place.
    useEffect(() => {
        saveTokens(tokens)
    }, [tokens])

    // tryRefresh swaps an expired access token for a fresh pair. Returns the
    // new access token on success, or null if the refresh token is also dead.
    const tryRefresh = useCallback(async (): Promise<string | null> => {
        const current = loadTokens()
        if (!current) return null
        try {
            const res = await request<{ access_token: string; refresh_token: string }>('/auth/refresh', {
                body: {refresh_token: current.refresh},
            })
            const next: TokenPair = {access: res.access_token, refresh: res.refresh_token}
            setTokens(next)
            return next.access
        } catch {
            setTokens(null)
            setUser(null)
            return null
        }
    }, [])

    // authedFetch wraps `request` with automatic 401 → refresh → retry. We do
    // not retry more than once: if the refresh attempt itself 401s, the user
    // is logged out and the caller sees the original error.
    const authedFetch = useCallback(async function <T>(
        path: string,
        opts: { method?: string; body?: unknown } = {},
    ): Promise<T> {
        const current = loadTokens()
        try {
            return await request<T>(path, {...opts, token: current?.access})
        } catch (e) {
            if (e instanceof APIErrorImpl && e.status === 401) {
                const fresh = await tryRefresh()
                if (fresh) return await request<T>(path, {...opts, token: fresh})
            }
            throw e
        }
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

    // On mount: if we already have tokens, hydrate the user record. Otherwise
    // we're done loading immediately.
    useEffect(() => {
        if (tokens) {
            void fetchMe()
        } else {
            setLoading(false)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const login = useCallback(async (username: string, password: string) => {
        const res = await request<{ access_token: string; refresh_token: string; user: User }>('/auth/login', {
            body: {username, password},
        })
        setTokens({access: res.access_token, refresh: res.refresh_token})
        setUser(res.user)
    }, [])

    const register = useCallback(async (args: RegisterArgs) => {
        const res = await request<{ access_token: string; refresh_token: string; user: User }>('/auth/register', {
            body: args,
        })
        setTokens({access: res.access_token, refresh: res.refresh_token})
        setUser(res.user)
    }, [])

    const logout = useCallback(async () => {
        const current = loadTokens()
        if (current) {
            try {
                await request('/auth/logout', {body: {refresh_token: current.refresh}, token: current.access})
            } catch {
                // best-effort; clear local state regardless
            }
        }
        setTokens(null)
        setUser(null)
    }, [])

    const value = useMemo<AuthState>(
        () => ({user, loading, login, register, logout, authedFetch}),
        [user, loading, login, register, logout, authedFetch],
    )

    return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthState {
    const v = useContext(Ctx)
    if (!v) throw new Error('useAuth must be used inside <AuthProvider>')
    return v
}
