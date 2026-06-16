import { ApiClient } from '@my239/shared'
import { WebTokenStore } from './token-store'

// The single ApiClient for the web app. baseURL is relative by default so
// requests are same-origin (proxied to the backend by Vite in dev, nginx in
// prod); override with VITE_API_BASE only for unusual setups.
export const apiClient = new ApiClient({
  baseURL: import.meta.env.VITE_API_BASE ?? '/api/v1',
  tokenStore: new WebTokenStore(),
})
