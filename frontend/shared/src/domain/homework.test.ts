import { describe, expect, it } from 'vitest'
import {
  claimIsLive,
  coffinOpen,
  currentSeries,
  displayStatusMeta,
  eventKindLabel,
  eventTone,
  homeworkStatusMeta,
  isClosed,
  problemStateFromSubproblems,
  resolveThreadRole,
  submissionClosedFor,
  userNameFromThread,
} from './homework'
import type { ThreadRoleInput } from './homework'
import type { HomeworkStatus, Series, ThreadView } from '../types'

describe('homeworkStatusMeta', () => {
  it('maps accepted', () => {
    expect(homeworkStatusMeta('accepted')).toEqual({
      label: 'Принято',
      tone: 'accepted',
      glyph: '✓',
    })
  })

  it('maps submitted to the checking tone', () => {
    expect(homeworkStatusMeta('submitted')).toEqual({
      label: 'Проверяется',
      tone: 'checking',
      glyph: '…',
    })
  })

  it('maps rejected', () => {
    expect(homeworkStatusMeta('rejected')).toEqual({
      label: 'Отклонено',
      tone: 'rejected',
      glyph: '✗',
    })
  })

  it('maps appealed to the appeal tone', () => {
    expect(homeworkStatusMeta('appealed')).toEqual({
      label: 'Апелляция',
      tone: 'appeal',
      glyph: '?',
    })
  })

  it('maps ungraded to the unsolved tone', () => {
    expect(homeworkStatusMeta('ungraded')).toEqual({
      label: 'Не решено',
      tone: 'unsolved',
      glyph: '○',
    })
  })
})

describe('problemStateFromSubproblems', () => {
  it('treats an empty list as ungraded', () => {
    expect(problemStateFromSubproblems([])).toBe('ungraded')
  })

  it('is accepted only when every subproblem is accepted', () => {
    expect(problemStateFromSubproblems(['accepted', 'accepted'])).toBe(
      'accepted',
    )
  })

  it('prefers appealed over rejected/submitted', () => {
    const statuses: HomeworkStatus[] = [
      'accepted',
      'rejected',
      'appealed',
      'submitted',
    ]
    expect(problemStateFromSubproblems(statuses)).toBe('appealed')
  })

  it('prefers rejected over submitted when no appeal', () => {
    expect(
      problemStateFromSubproblems(['accepted', 'submitted', 'rejected']),
    ).toBe('rejected')
  })

  it('reports submitted when something is in review and nothing worse', () => {
    expect(problemStateFromSubproblems(['accepted', 'submitted'])).toBe(
      'submitted',
    )
  })

  it('falls back to ungraded', () => {
    expect(problemStateFromSubproblems(['ungraded', 'accepted'])).toBe(
      'ungraded',
    )
  })
})

describe('currentSeries', () => {
  const NOW = Date.parse('2026-06-18T00:00:00Z')

  function makeSeries(over: Partial<Series>): Series {
    return {
      id: 1,
      math_center_id: 1,
      number: 1,
      name: 'S',
      display_name: 'S1',
      due_at: '2026-07-01T00:00:00Z',
      published: true,
      has_pdf: false,
      has_tex: false,
      has_solution_tex: false,
      has_solution_pdf: false,
      problems: [],
      ...over,
    }
  }

  it('returns undefined when there are no published series', () => {
    const drafts = [makeSeries({ id: 1, published: false })]
    expect(currentSeries(drafts, NOW)).toBeUndefined()
  })

  it('picks the soonest due date at or after now', () => {
    const list = [
      makeSeries({ id: 1, number: 1, due_at: '2026-08-01T00:00:00Z' }),
      makeSeries({ id: 2, number: 2, due_at: '2026-06-20T00:00:00Z' }),
      makeSeries({ id: 3, number: 3, due_at: '2026-07-10T00:00:00Z' }),
    ]
    expect(currentSeries(list, NOW)?.id).toBe(2)
  })

  it('ignores overdue series when something upcoming exists', () => {
    const list = [
      makeSeries({ id: 1, number: 1, due_at: '2026-05-01T00:00:00Z' }),
      makeSeries({ id: 2, number: 2, due_at: '2026-07-01T00:00:00Z' }),
    ]
    expect(currentSeries(list, NOW)?.id).toBe(2)
  })

  it('falls back to the highest number when everything is overdue', () => {
    const list = [
      makeSeries({ id: 1, number: 1, due_at: '2026-05-01T00:00:00Z' }),
      makeSeries({ id: 2, number: 3, due_at: '2026-04-01T00:00:00Z' }),
      makeSeries({ id: 3, number: 2, due_at: '2026-05-15T00:00:00Z' }),
    ]
    expect(currentSeries(list, NOW)?.id).toBe(2)
  })

  it('ignores draft series in the fallback', () => {
    const list = [
      makeSeries({ id: 1, number: 9, published: false, due_at: '2026-05-01T00:00:00Z' }),
      makeSeries({ id: 2, number: 2, due_at: '2026-05-01T00:00:00Z' }),
    ]
    expect(currentSeries(list, NOW)?.id).toBe(2)
  })
})

describe('eventKindLabel', () => {
  it('splits a graded event on its verdict', () => {
    expect(eventKindLabel('graded', 'accepted')).toBe('Принято')
    expect(eventKindLabel('graded', 'rejected')).toBe('Отклонено')
  })

  it('labels submission, appeal, and retraction', () => {
    expect(eventKindLabel('submitted')).toBe('Решение')
    expect(eventKindLabel('appealed')).toBe('Апелляция')
    expect(eventKindLabel('retracted')).toBe('Оценка отозвана')
  })
})

describe('eventTone', () => {
  it('maps graded verdicts and appeals to status tones', () => {
    expect(eventTone('graded', 'accepted')).toBe('accepted')
    expect(eventTone('graded', 'rejected')).toBe('rejected')
    expect(eventTone('appealed')).toBe('appeal')
  })

  it('returns null for neutral events (submitted, retracted)', () => {
    expect(eventTone('submitted')).toBeNull()
    expect(eventTone('retracted')).toBeNull()
  })
})

describe('isClosed', () => {
  const NOW = Date.parse('2030-06-01T00:00:00Z')
  it('is true once the deadline has passed', () => {
    expect(isClosed('2030-05-01T00:00:00Z', NOW)).toBe(true)
  })
  it('is false before the deadline and for missing/invalid dates', () => {
    expect(isClosed('2030-07-01T00:00:00Z', NOW)).toBe(false)
    expect(isClosed(null, NOW)).toBe(false)
    expect(isClosed('not-a-date', NOW)).toBe(false)
  })
})

describe('claimIsLive', () => {
  const NOW = Date.parse('2030-06-01T00:00:00Z')
  it('is false with no holder', () => {
    expect(claimIsLive({ claim_holder_user_id: null, claim_expires_at: null }, NOW)).toBe(false)
  })
  it('is true while held and unexpired', () => {
    expect(
      claimIsLive(
        { claim_holder_user_id: 2, claim_expires_at: '2030-06-01T00:10:00Z' },
        NOW,
      ),
    ).toBe(true)
  })
  it('is false once the lease has expired', () => {
    expect(
      claimIsLive(
        { claim_holder_user_id: 2, claim_expires_at: '2030-05-31T23:50:00Z' },
        NOW,
      ),
    ).toBe(false)
  })
})

describe('userNameFromThread', () => {
  const thread = { users: { '2': 'Пётр Иванов' } } as unknown as ThreadView
  it('resolves a known id and falls back gracefully', () => {
    expect(userNameFromThread(thread, 2)).toBe('Пётр Иванов')
    expect(userNameFromThread(thread, 9)).toBe('неизвестно')
    expect(userNameFromThread(thread, null)).toBe('')
  })
})

describe('displayStatusMeta', () => {
  it('splits submitted into queued vs being-graded', () => {
    expect(displayStatusMeta('submitted', false)).toEqual({
      label: 'В очереди',
      tone: 'checking',
      glyph: '…',
    })
    expect(displayStatusMeta('submitted', true)).toEqual({
      label: 'На проверке',
      tone: 'grading',
      glyph: '◐',
    })
  })

  it('splits appealed into queued vs being-graded', () => {
    expect(displayStatusMeta('appealed', false).tone).toBe('appeal')
    expect(displayStatusMeta('appealed', true).tone).toBe('grading')
  })

  it('ignores beingGraded for terminal/untouched states', () => {
    expect(displayStatusMeta('accepted', true).label).toBe('Принято')
    expect(displayStatusMeta('rejected', true).label).toBe('Отклонено')
    expect(displayStatusMeta('ungraded', true).label).toBe('Не решено')
  })
})

describe('resolveThreadRole', () => {
  const base: ThreadRoleInput = {
    isAdmin: false,
    actingAsUserId: null,
    realUserId: 50,
    teacherCenterIds: [],
    studentCenterId: null,
    centerId: 5,
  }

  it('treats an admin as the grading superset', () => {
    expect(resolveThreadRole({ ...base, isAdmin: true }).role).toBe('admin')
  })

  it('is a teacher of a center they teach', () => {
    expect(
      resolveThreadRole({ ...base, teacherCenterIds: [5] }).role,
    ).toBe('teacher')
  })

  it('is the student when it is their center and their thread', () => {
    const r = resolveThreadRole({
      ...base,
      realUserId: 7,
      studentCenterId: 5,
      threadStudentUserId: 7,
    })
    expect(r.role).toBe('student')
    expect(r.userId).toBe(7)
  })

  it('is not the student for someone else’s thread in their center', () => {
    expect(
      resolveThreadRole({
        ...base,
        realUserId: 7,
        studentCenterId: 5,
        threadStudentUserId: 99,
      }).role,
    ).toBe('none')
  })

  // Regression: an admin impersonating a student must resolve as that STUDENT
  // (not admin), and the effective viewer id must be the impersonated user —
  // /auth/me still returns the real admin under impersonation, so using
  // realUserId would mis-label "Вы" and hide the student's appeal box.
  it('resolves an impersonating admin as the impersonated student', () => {
    const r = resolveThreadRole({
      isAdmin: true,
      actingAsUserId: 7,
      realUserId: 50,
      teacherCenterIds: [],
      studentCenterId: 5,
      centerId: 5,
      threadStudentUserId: 7,
    })
    expect(r.role).toBe('student')
    expect(r.userId).toBe(7)
  })
})

describe('submissionClosedFor', () => {
  const now = Date.parse('2030-06-01T12:00:00Z')
  const past = '2030-05-01T00:00:00Z'
  const future = '2030-07-01T00:00:00Z'
  it('normal problem closes at the series deadline', () => {
    expect(submissionClosedFor({ is_coffin: false, series_due_at: future }, now)).toBe(false)
    expect(submissionClosedFor({ is_coffin: false, series_due_at: past }, now)).toBe(true)
  })
  it('coffin stays open past due until released', () => {
    expect(submissionClosedFor({ is_coffin: true, coffin_released_at: null, series_due_at: past }, now)).toBe(false)
    expect(submissionClosedFor({ is_coffin: true, coffin_released_at: past, series_due_at: past }, now)).toBe(true)
    expect(submissionClosedFor({ is_coffin: true, coffin_released_at: future, series_due_at: past }, now)).toBe(false)
  })
})

describe('coffinOpen', () => {
  const now = Date.parse('2030-06-01T12:00:00Z')
  it('is open with no release, closed once released', () => {
    expect(coffinOpen(null, now)).toBe(true)
    expect(coffinOpen('2030-05-01T00:00:00Z', now)).toBe(false)
    expect(coffinOpen('2030-07-01T00:00:00Z', now)).toBe(true)
  })
})
