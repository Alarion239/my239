// Pure, platform-agnostic helpers for presenting and aggregating homework
// series state. No I/O, no React, no DOM — safe to use from web, native, or
// tests. The web layer maps `tone` to its own colour tokens.

import type {
  EventKind,
  HomeworkStatus,
  Series,
  ThreadView,
  Verdict,
} from '../types'

// StatusTone is the abstract visual category a platform maps to its own colour
// palette. Keeping it abstract (not a colour) keeps this file platform-agnostic.
// `checking` (amber) = awaiting a grader; `grading` (blue) = a grader has it.
export type StatusTone =
  | 'accepted'
  | 'checking'
  | 'grading'
  | 'rejected'
  | 'appeal'
  | 'unsolved'

export interface StatusMeta {
  label: string
  tone: StatusTone
  glyph: string
}

// homeworkStatusMeta maps a raw status to its Russian label, abstract tone, and
// a compact glyph. This is the claim-unaware view (used where claim state isn't
// available); for the "В очереди" vs "На проверке" split see displayStatusMeta.
export function homeworkStatusMeta(status: HomeworkStatus): StatusMeta {
  switch (status) {
    case 'accepted':
      return { label: 'Принято', tone: 'accepted', glyph: '✓' }
    case 'submitted':
      return { label: 'Проверяется', tone: 'checking', glyph: '…' }
    case 'rejected':
      return { label: 'Отклонено', tone: 'rejected', glyph: '✗' }
    case 'appealed':
      return { label: 'Апелляция', tone: 'appeal', glyph: '?' }
    case 'ungraded':
      return { label: 'Не решено', tone: 'unsolved', glyph: '○' }
  }
}

// displayStatusMeta is the claim-AWARE presentation: it splits the "checking"
// family by whether a grader currently holds the thread, so both students and
// graders can tell "В очереди" (queued, amber) from "На проверке" (being
// graded, blue). `beingGraded` is the live-claim signal — from the rollup's
// `being_graded` flag (students) or claimIsLive(cell/thread) (graders).
export function displayStatusMeta(
  status: HomeworkStatus,
  beingGraded: boolean,
): StatusMeta {
  switch (status) {
    case 'accepted':
      return { label: 'Принято', tone: 'accepted', glyph: '✓' }
    case 'rejected':
      return { label: 'Отклонено', tone: 'rejected', glyph: '✗' }
    case 'submitted':
      return beingGraded
        ? { label: 'На проверке', tone: 'grading', glyph: '◐' }
        : { label: 'В очереди', tone: 'checking', glyph: '…' }
    case 'appealed':
      return beingGraded
        ? { label: 'Апелляция · проверка', tone: 'grading', glyph: '◐' }
        : { label: 'Апелляция в очереди', tone: 'appeal', glyph: '?' }
    case 'ungraded':
      return { label: 'Не решено', tone: 'unsolved', glyph: '○' }
  }
}

// problemStateFromSubproblems collapses a problem's subproblem statuses into a
// single problem-level status, using the SAME precedence the backend applies
// when computing stats: all accepted -> accepted; else any appealed -> appealed;
// else any rejected -> rejected; else any submitted -> submitted; else
// ungraded. An empty list is treated as ungraded.
export function problemStateFromSubproblems(
  statuses: HomeworkStatus[],
): HomeworkStatus {
  if (statuses.length === 0) return 'ungraded'
  if (statuses.every((s) => s === 'accepted')) return 'accepted'
  if (statuses.some((s) => s === 'appealed')) return 'appealed'
  if (statuses.some((s) => s === 'rejected')) return 'rejected'
  if (statuses.some((s) => s === 'submitted')) return 'submitted'
  return 'ungraded'
}

// currentSeries picks the "current" series from a list: the published series
// with the soonest due_at that is still at or after `nowMs`. When nothing is
// upcoming (all overdue, or none published with a future due date), it falls
// back to the published series with the highest number. Returns undefined when
// there are no published series. `nowMs` is injectable for testability; on a
// device Date.now() is fine since this runs on-device.
export function currentSeries(
  series: Series[],
  nowMs: number = Date.now(),
): Series | undefined {
  const published = series.filter((s) => s.published)
  if (published.length === 0) return undefined

  let upcoming: Series | undefined
  let upcomingMs = Infinity
  for (const s of published) {
    const due = Date.parse(s.due_at)
    if (Number.isNaN(due) || due < nowMs) continue
    if (due < upcomingMs) {
      upcoming = s
      upcomingMs = due
    }
  }
  if (upcoming) return upcoming

  // Fallback: the highest-numbered published series.
  return published.reduce((best, s) => (s.number > best.number ? s : best))
}

// --- Thread role resolution --------------------------------------------------

// ThreadRole is how a viewer relates to a thread: the owning student, a teacher
// of its center, an admin (full grading superset), or none.
export type ThreadRole = 'student' | 'teacher' | 'admin' | 'none'

export interface ThreadRoleInput {
  // Real account admin flag (from /auth/me, which does NOT honour act-as).
  isAdmin: boolean
  // Impersonated user id when an admin is "viewing as" someone, else null.
  actingAsUserId: number | null
  // The real account's user id (from /auth/me).
  realUserId: number
  // Centers the (effective) user teaches, and their student center.
  teacherCenterIds: number[]
  studentCenterId: number | null
  // The center the thread belongs to.
  centerId: number
  // The thread owner; undefined in the first-submission flow (no thread yet),
  // where the student check relies on center membership alone.
  threadStudentUserId?: number
}

// resolveThreadRole decides the viewer's role AND the effective viewer id.
//
// The subtlety this centralises: while impersonating, /auth/me still returns
// the real admin (the act-as header is not sent to auth endpoints), so the
// viewer id must come from actingAsUserId — otherwise "Вы" labelling and the
// student-owner check both compare against the wrong id. Admin also loses its
// grading superset under impersonation, matching the backend, which rewrites
// is_admin to false for the impersonated request.
export function resolveThreadRole(input: ThreadRoleInput): {
  role: ThreadRole
  userId: number
} {
  const impersonating = input.actingAsUserId != null
  const userId = impersonating ? (input.actingAsUserId as number) : input.realUserId
  const effectiveAdmin = input.isAdmin && !impersonating

  let role: ThreadRole = 'none'
  if (effectiveAdmin) {
    role = 'admin'
  } else if (input.teacherCenterIds.includes(input.centerId)) {
    role = 'teacher'
  } else if (
    input.studentCenterId === input.centerId &&
    (input.threadStudentUserId === undefined ||
      input.threadStudentUserId === userId)
  ) {
    role = 'student'
  }

  return { role, userId }
}

// --- Thread / timeline helpers -----------------------------------------------

// eventKindLabel renders the Russian heading for one timeline event. A graded
// event splits on its verdict so the card reads "Принято" / "Отклонено".
export function eventKindLabel(
  kind: EventKind,
  verdict?: Verdict | null,
): string {
  switch (kind) {
    case 'submitted':
      return 'Решение'
    case 'graded':
      return verdict === 'accepted' ? 'Принято' : 'Отклонено'
    case 'retracted':
      return 'Оценка отозвана'
    case 'appealed':
      return 'Апелляция'
    case 'claimed':
      return 'Взято в проверку'
    case 'released':
      return 'Освобождено'
    case 'accepted_offline':
      return 'Принято очно'
    case 'offline_retracted':
      return 'Очный зачёт отменён'
  }
}

// initialsOf builds a person's initials from a display name: the first letter
// of the first whitespace-separated token plus the first letter of the last
// (Cyrillic-safe). Mirrors the server's user-id → initials rule so registered
// and free-text offline graders render the same way in the «Кондуит».
//
// A single short token (≤2 letters, e.g. "АБ") is taken to already BE initials
// — there are no two-letter names — so it's returned whole rather than
// collapsed to one letter.
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return ''
  if (parts.length === 1 && [...parts[0]].length <= 2) {
    return parts[0].toUpperCase()
  }
  const first = [...parts[0]][0] ?? ''
  const last = parts.length > 1 ? ([...parts[parts.length - 1]][0] ?? '') : ''
  return (first + last).toUpperCase()
}

// eventTone maps a timeline event to an abstract StatusTone so the web layer
// can colour its left-border accent from the same status tokens used by tiles.
// `null` means "no status tint" (neutral/ink) — used for plain submissions and
// retractions, which aren't a grading outcome.
export function eventTone(
  kind: EventKind,
  verdict?: Verdict | null,
): StatusTone | null {
  switch (kind) {
    case 'graded':
      return verdict === 'accepted' ? 'accepted' : 'rejected'
    case 'accepted_offline':
      return 'accepted'
    case 'appealed':
      return 'appeal'
    default:
      return null
  }
}

// isClosed reports whether a series deadline has passed. Centralised so every
// surface that branches on "can submit / view-only" stays in lockstep.
// `nowMs` is injectable for testability.
export function isClosed(
  dueAt: string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!dueAt) return false
  const t = Date.parse(dueAt)
  return Number.isFinite(t) && t < nowMs
}

// claimIsLive reports whether a claim lock is currently held (set and not
// expired). `nowMs` is injectable for testability.
export function claimIsLive(
  thread: Pick<ThreadView, 'claim_holder_user_id' | 'claim_expires_at'>,
  nowMs: number = Date.now(),
): boolean {
  if (thread.claim_holder_user_id == null) return false
  if (!thread.claim_expires_at) return true
  const t = Date.parse(thread.claim_expires_at)
  return Number.isNaN(t) || t > nowMs
}

// userNameFromThread resolves a user_id appearing on a thread to its display
// name, with a sensible fallback when the id isn't in the map (e.g. a deleted
// actor on an old event).
export function userNameFromThread(
  thread: ThreadView,
  userId: number | null | undefined,
): string {
  if (userId == null) return ''
  return thread.users[String(userId)] ?? 'неизвестно'
}

// --- Coffin-aware submission gating -----------------------------------------

// CoffinGate is the subset of SubproblemContext needed to decide whether NEW
// submissions are open. Mirrors backend internal/homework.SubmissionClosed.
export interface CoffinGate {
  is_coffin: boolean
  coffin_released_at?: string | null
  series_due_at: string
}

// submissionClosedFor reports whether new submissions are closed for a
// subproblem: a normal problem closes at the series deadline; a coffin stays
// open past it until its own solution is released. `nowMs` is injectable.
export function submissionClosedFor(
  ctx: CoffinGate,
  nowMs: number = Date.now(),
): boolean {
  if (ctx.is_coffin) {
    if (!ctx.coffin_released_at) return false
    const t = Date.parse(ctx.coffin_released_at)
    return Number.isFinite(t) && t <= nowMs
  }
  const due = Date.parse(ctx.series_due_at)
  return Number.isFinite(due) && due <= nowMs
}

// coffinOpen reports whether a coffin still accepts submissions (not released).
export function coffinOpen(
  releasedAt: string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!releasedAt) return true
  const t = Date.parse(releasedAt)
  return Number.isFinite(t) ? t > nowMs : true
}
