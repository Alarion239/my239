// ApiClient is the high-level, platform-agnostic surface every client app
// talks to. It owns the access token in memory, persists the rotating refresh
// token through an injected TokenStore, and transparently handles the
// 401 -> refresh -> retry dance so callers never think about token lifetimes.
//
// Construction is the only place a platform supplies its specifics: the base
// URL (relative "/api/v1" on web behind nginx; a LAN URL on native) and a
// TokenStore implementation. Everything below is shared verbatim.

import { APIErrorImpl, request } from './http'
import type { TokenStore } from '../ports/token-store'
import type {
  AuthResult,
  LoginRequest,
  RegisterRequest,
  TokenPair,
  User,
} from '../types'

export interface ApiClientOptions {
  baseURL: string
  tokenStore: TokenStore
}

export class ApiClient {
  private readonly baseURL: string
  private readonly tokenStore: TokenStore
  private accessToken: string | null = null
  // Single-flight guard: concurrent requests that all 401 share one refresh
  // instead of stampeding /auth/refresh (which would rotate the token N times
  // and invalidate every in-flight attempt but the first).
  private refreshing: Promise<string | null> | null = null

  constructor(opts: ApiClientOptions) {
    this.baseURL = opts.baseURL
    this.tokenStore = opts.tokenStore
  }

  // request is the JSON workhorse: try with the current access token, and on a
  // 401 refresh once and retry. A second 401 propagates to the caller.
  async request<T>(
    path: string,
    opts: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    try {
      return await request<T>(this.baseURL, path, { ...opts, token: this.accessToken })
    } catch (e) {
      if (e instanceof APIErrorImpl && e.status === 401) {
        const fresh = await this.refresh()
        if (fresh) {
          return await request<T>(this.baseURL, path, { ...opts, token: fresh })
        }
      }
      throw e
    }
  }

  private async refresh(): Promise<string | null> {
    if (this.refreshing) return this.refreshing
    this.refreshing = this.doRefresh()
    try {
      return await this.refreshing
    } finally {
      this.refreshing = null
    }
  }

  private async doRefresh(): Promise<string | null> {
    const refreshToken = await this.tokenStore.getRefreshToken()
    if (!refreshToken) return null
    try {
      const res = await request<TokenPair>(this.baseURL, '/auth/refresh', {
        body: { refresh_token: refreshToken },
      })
      this.accessToken = res.access_token
      await this.tokenStore.setRefreshToken(res.refresh_token)
      return res.access_token
    } catch {
      // Refresh token is dead (expired/rotated/revoked). Clear everything so
      // the app falls back to the signed-out state.
      this.accessToken = null
      await this.tokenStore.clear()
      return null
    }
  }

  async login(body: LoginRequest): Promise<User> {
    const res = await request<AuthResult>(this.baseURL, '/auth/login', { body })
    this.accessToken = res.access_token
    await this.tokenStore.setRefreshToken(res.refresh_token)
    return res.user
  }

  async register(body: RegisterRequest): Promise<User> {
    const res = await request<AuthResult>(this.baseURL, '/auth/register', { body })
    this.accessToken = res.access_token
    await this.tokenStore.setRefreshToken(res.refresh_token)
    return res.user
  }

  async logout(): Promise<void> {
    const refreshToken = await this.tokenStore.getRefreshToken()
    if (refreshToken) {
      try {
        await request(this.baseURL, '/auth/logout', {
          body: { refresh_token: refreshToken },
          token: this.accessToken,
        })
      } catch {
        // Best effort: the server treats unknown tokens as already revoked, so
        // local cleanup below is what actually signs the user out.
      }
    }
    this.accessToken = null
    await this.tokenStore.clear()
  }

  async me(): Promise<User> {
    return this.request<User>('/auth/me')
  }

  // meOrNull resolves a 401 (no/expired session that couldn't be refreshed) to
  // null instead of throwing, so it can back a TanStack Query that models the
  // signed-out state as data rather than an error.
  async meOrNull(): Promise<User | null> {
    try {
      return await this.me()
    } catch (e) {
      if (e instanceof APIErrorImpl && e.status === 401) return null
      throw e
    }
  }
}
