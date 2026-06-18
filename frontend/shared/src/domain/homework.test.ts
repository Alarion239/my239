import { describe, expect, it } from 'vitest'
import {
  currentSeries,
  homeworkStatusMeta,
  problemStateFromSubproblems,
} from './homework'
import type { HomeworkStatus, Series } from '../types'

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
