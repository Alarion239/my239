import type { TokenStore } from '@my239/shared'

// WebTokenStore implements the shared TokenStore port with localStorage. Only
// the rotating refresh token is persisted; the access token stays in memory
// inside ApiClient. (The future native app provides an expo-secure-store impl.)
const KEY = 'my239.refresh'

export class WebTokenStore implements TokenStore {
  async getRefreshToken(): Promise<string | null> {
    try {
      return localStorage.getItem(KEY)
    } catch {
      return null
    }
  }

  async setRefreshToken(token: string | null): Promise<void> {
    try {
      if (token) localStorage.setItem(KEY, token)
      else localStorage.removeItem(KEY)
    } catch {
      // Storage can throw in private mode / quota; sessions just won't persist.
    }
  }

  async clear(): Promise<void> {
    try {
      localStorage.removeItem(KEY)
    } catch {
      // ignore
    }
  }
}
