// Pure, platform-agnostic helpers for presenting and aggregating homework
// series state. No I/O, no React, no DOM — safe to use from web, native, or
// tests. The web layer maps `tone` to its own colour tokens.

import type { HomeworkStatus, Series } from '../types'

// StatusTone is the abstract visual category a platform maps to its own colour
// palette. Keeping it abstract (not a colour) keeps this file platform-agnostic.
export type StatusTone =
  | 'accepted'
  | 'checking'
  | 'rejected'
  | 'appeal'
  | 'unsolved'

export interface StatusMeta {
  label: string
  tone: StatusTone
  glyph: string
}

// homeworkStatusMeta maps a status to its Russian label, abstract tone, and a
// compact glyph for dense lists.
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
