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

// --- Admin -------------------------------------------------------------------
// Wire types for the admin endpoints (all under /admin, admin-gated). Keep in
// sync with backend/internal/handlers/admin.

// InvitationToken mirrors the admin TokenView: a registration invite with a
// usage quota and an expiry. The raw token string is only exposed to admins.
export interface InvitationToken {
  id: number
  token: string
  description: string
  max_uses: number
  uses: number
  expires_at: string
  created_at: string
}

// MathCenter is a cohort grouped by graduation year.
export interface MathCenter {
  id: number
  graduation_year: number
  created_at: string
}

// MathCenterGroup is a named group within a math center.
export interface MathCenterGroup {
  id: number
  math_center_id: number
  name: string
  created_at: string
}

// --- Math center "Серии" (homework series) -----------------------------------
// Wire types for the series endpoints. Keep in sync with
// backend/internal/handlers/mathcenter (seriesView) and the homework rollup /
// stats handlers.

// HomeworkStatus is the grading state of a single subproblem thread. Mirrors
// the backend status enum.
export type HomeworkStatus =
  | 'ungraded'
  | 'submitted'
  | 'accepted'
  | 'rejected'
  | 'appealed'

// SeriesProblem is one problem within a series, with its subproblem labels.
export interface SeriesProblem {
  id: number
  number: number
  display_name: string
  subproblems: string[]
}

// Series mirrors the backend seriesView: a numbered homework set with a due
// date, publication state, and the available PDF/TeX artefacts.
export interface Series {
  id: number
  math_center_id: number
  number: number
  name: string
  display_name: string
  due_at: string
  published: boolean
  published_at?: string | null
  has_pdf: boolean
  has_tex: boolean
  problems: SeriesProblem[]
}

// RollupSubproblem is one subproblem's status in a student's own rollup
// (GET /homework/series/{id}/my).
export interface RollupSubproblem {
  subproblem_id: number
  subproblem_label: string
  thread_id: number
  current_status: HomeworkStatus
}

export interface RollupProblem {
  problem_id: number
  problem_number: number
  problem_display: string
  subproblems: RollupSubproblem[]
}

// MyRollup is the student-facing view of their own progress on a series.
export interface MyRollup {
  counts: {
    accepted: number
    rejected: number
    pending: number
  }
  problems: RollupProblem[]
}

// SeriesProblemStat is per-problem aggregate counts across all students in the
// teacher stats view (GET /homework/series/{id}/problem-stats).
export interface SeriesProblemStat {
  problem_id: number
  problem_number: number
  problem_display: string
  accepted: number
  appealed: number
  rejected: number
  submitted: number
  unsolved: number
}

export interface SeriesProblemStats {
  total_students: number
  problems: SeriesProblemStat[]
}

// PdfUploadURL is the presigned target for a direct-to-storage series PDF
// upload (POST /mathcenter/series/{id}/pdf/upload-url).
export interface PdfUploadURL {
  object_key: string
  upload_url: string
}
