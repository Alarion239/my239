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

// --- Math center "me" view ---------------------------------------------------
// Mirrors backend/internal/handlers/mathcenter/me.go. The response is a union:
// exactly one of teacher / student may be populated; both absent means the user
// holds no math-center role.

export interface CenterInfo {
  id: number
  graduation_year: number
  grade: number
}

export interface GroupInfo {
  id: number
  name: string
}

export interface TeacherInfo {
  user_id: number
  display_name: string
  is_head_teacher: boolean
}

export interface StudentInfo {
  user_id: number
  display_name: string
}

export interface GroupWithStudents {
  id: number
  name: string
  students: StudentInfo[]
}

export interface TeacherCenterView {
  id: number
  graduation_year: number
  grade: number
  is_head_teacher: boolean
  teachers: TeacherInfo[]
  groups: GroupWithStudents[]
}

export interface TeacherView {
  centers: TeacherCenterView[]
}

export interface StudentView {
  center: CenterInfo
  group: GroupInfo
  head_teachers: TeacherInfo[]
}

export interface MeResponse {
  teacher?: TeacherView | null
  student?: StudentView | null
}
