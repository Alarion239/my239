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

// MathCenterTeacher mirrors store.MathCenterTeacher — the join row returned when
// an admin enrolls a user as a teacher of a center.
export interface MathCenterTeacher {
  id: number
  user_id: number
  math_center_id: number
  is_head_teacher: boolean
  created_at: string
}

// MathCenterStudent mirrors store.MathCenterStudent — the join row returned when
// an admin enrolls a user as a student of a group.
export interface MathCenterStudent {
  id: number
  user_id: number
  group_id: number
  created_at: string
}

// --- Admin user management ---------------------------------------------------
// Wire types for the admin "manage a single user" view: a user's teaching and
// student enrollments across math centers. Keep in sync with
// backend/internal/handlers/admin (GET /admin/users/{id}/enrollments).

// TeacherEnrollment is one center a user teaches in, flattened for display.
export interface TeacherEnrollment {
  teacher_id: number
  center_id: number
  graduation_year: number
  grade: number
  is_head_teacher: boolean
}

// StudentEnrollment is the single group/center a user studies in (a user is a
// student of at most one group), flattened for display.
export interface StudentEnrollment {
  student_id: number
  center_id: number
  group_id: number
  group_name: string
  graduation_year: number
  grade: number
}

// UserEnrollments is the union of a user's roles: any number of teaching rows,
// and at most one student row (null when the user is not a student).
export interface UserEnrollments {
  teaching: TeacherEnrollment[]
  student: StudentEnrollment | null
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

// --- Homework threads: submission / appeal / grading -------------------------
// Wire types for the per-(student, subproblem) thread that carries an
// event-sourced timeline (submit → grade → appeal → re-grade / retract). Keep
// in sync with backend/internal/handlers/homework (get_thread.go, grade.go,
// grader_queue.go, teacher_grid.go, grader_stats.go).

// Verdict is a teacher's binary decision on an attempt.
export type Verdict = 'accepted' | 'rejected'

// EventKind is the type of one timeline entry. `claimed`/`released` are logged
// server-side but not surfaced as cards in the current UI.
export type EventKind =
  | 'submitted'
  | 'appealed'
  | 'graded'
  | 'retracted'
  | 'claimed'
  | 'released'

// PhotoView is one image attached to an event. `url` is a short-TTL presigned
// GET; `object_key` is exposed too so the UI can match images back to events.
export interface PhotoView {
  index: number
  object_key: string
  url: string
  content_type: string
  size_bytes: number
}

// EventView mirrors one homework_thread_event row plus its photos.
export interface EventView {
  id: number
  event_uuid: string
  kind: EventKind
  actor_user_id: number
  body: string
  verdict?: Verdict | null
  refers_to_event_id?: number | null
  created_at: string
  photos: PhotoView[]
}

// ThreadView is the full timeline + cache state for one thread (GET
// /homework/threads/by-id/{id}). `users` maps every user_id that appears on the
// page (student, claim holder, last grader, event actors) → display name, so
// the UI never renders "пользователь #N". `series_due_at` lets the UI gate the
// submit form after the deadline without an extra round-trip.
export interface ThreadView {
  id: number
  student_user_id: number
  subproblem_id: number
  series_id: number
  series_due_at: string
  math_center_id: number
  current_status: HomeworkStatus
  last_grader_user_id?: number | null
  claim_holder_user_id?: number | null
  claim_expires_at?: string | null
  created_at: string
  updated_at: string
  events: EventView[]
  users: Record<string, string>
}

// UploadSlot is one presigned PUT target minted for a photo upload.
export interface UploadSlot {
  index: number
  object_key: string
  upload_url: string
  content_type: string
}

// UploadURLsResponse is the result of requesting upload URLs: the event UUID to
// echo back on submit/grade, plus one slot per requested content type.
export interface UploadURLsResponse {
  event_uuid: string
  slots: UploadSlot[]
}

// SubmitOrAppealPayload is the finalize body for a student submit or appeal.
export interface SubmitOrAppealPayload {
  event_uuid: string
  body: string
  object_keys: string[]
}

// GradePayload is the finalize body for a teacher grade (verdict required).
export interface GradePayload {
  verdict: Verdict
  body: string
  event_uuid: string
  object_keys: string[]
}

// SubproblemContext is what the "new submission" page needs before any thread
// exists: the series due-date (to gate the form) and the problem/series
// identifiers so navigation can return to the right place
// (GET /homework/subproblems/{id}).
export interface SubproblemContext {
  subproblem_id: number
  subproblem_label: string
  problem_id: number
  problem_number: number
  problem_display: string
  series_id: number
  math_center_id: number
  series_due_at: string
  series_published_at?: string | null
}

// QueueItem is one row of the grader queue (GET /homework/series/{id}/queue):
// a submission/appeal awaiting grading.
export interface QueueItem {
  thread_id: number
  student_user_id: number
  student_name: string
  subproblem_id: number
  subproblem_label: string
  problem_number: number
  problem_display: string
  current_status: HomeworkStatus
  last_grader_user_id?: number | null
  claim_holder_user_id?: number | null
  claim_expires_at?: string | null
  updated_at: string
}

// GraderStats are the at-a-glance workload counters for a center
// (GET /homework/centers/{id}/grader-stats).
export interface GraderStats {
  pending_count: number
  my_claimed_count: number
  my_appeals_count: number
}

// --- Teacher per-series grid (GET /homework/series/{id}/grid) -----------------

export interface GridColumn {
  subproblem_id: number
  subproblem_label: string
  problem_id: number
  problem_number: number
  problem_display: string
}

// GridCell is one (student × subproblem) status. `thread_id` is 0 when no
// thread exists yet (the student has never submitted).
export interface GridCell {
  subproblem_id: number
  subproblem_label: string
  problem_id: number
  problem_number: number
  thread_id: number
  current_status: HomeworkStatus
  last_grader_user_id?: number | null
  claim_holder_user_id?: number | null
  claim_expires_at?: string | null
}

export interface GridStudent {
  student_user_id: number
  student_name: string
  group_id: number
  group_name: string
  cells: GridCell[]
}

export interface GridResponse {
  columns: GridColumn[]
  students: GridStudent[]
}
