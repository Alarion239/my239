// Wire types mirroring the backend JSON contracts. These are the source of
// truth shared by every platform — keep field names and optionality in sync
// with the Go structs in backend/internal/store and the auth handlers.

// User mirrors store.User (backend/internal/store/models.go). PasswordHash is
// excluded server-side (json:"-") so it never appears here.
export interface User {
  id: number
  username: string
  first_name: string
  middle_name?: string | null
  last_name: string
  created_at: string
  updated_at: string
  is_admin: boolean
  is_math_center: boolean
}

// TokenPair is returned by /auth/refresh and embedded in AuthResult. The
// refresh token is opaque and rotated on every exchange; the access token is
// a short-lived JWT carried in the Authorization header.
export interface TokenPair {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
}

// AuthResult is the body of /auth/login and /auth/register: a token pair plus
// the authenticated user record.
export interface AuthResult extends TokenPair {
  user: User
}

export interface LoginRequest {
  username: string
  password: string
}

export interface RegisterRequest {
  username: string
  password: string
  invitation_token: string
  first_name: string
  middle_name?: string | null
  last_name: string
}

// ErrorEnvelope is the backend's uniform error body (internal/httpx). The
// HTTP layer turns this into an APIError so callers branch on status/code.
export interface ErrorEnvelope {
  code?: string
  error?: string
  fields?: Record<string, string>
  trace_id?: string
}
