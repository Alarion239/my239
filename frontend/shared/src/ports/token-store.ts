// TokenStore is the single platform capability the shared API client needs:
// somewhere durable to keep the rotating refresh token. The access token lives
// only in memory inside ApiClient (never persisted) and is re-minted from the
// refresh token after a reload or app relaunch.
//
// Web implements this with localStorage; the future React Native app will
// implement it with expo-secure-store. The shared package depends ONLY on this
// interface — it never imports a concrete storage backend. Methods are async
// so secure-store (which is async on native) fits without changing callers.
export interface TokenStore {
  getRefreshToken(): Promise<string | null>
  setRefreshToken(token: string | null): Promise<void>
  clear(): Promise<void>
}
