import { describe, expect, it } from 'vitest'
import type { MathCenterTerm } from '@my239/shared'
import { nextMathCenterTerm, nextTermDisplayName, shouldShowTermRollover } from './term-rollover'

function makeTerm(overrides: Partial<MathCenterTerm> = {}): MathCenterTerm {
  return {
    id: 1,
    math_center_id: 1,
    kind: 'academic',
    grade: 5,
    display_name: '5 класс',
    is_active: true,
    ...overrides,
  }
}

describe('term rollover', () => {
  it('selects the same-grade camp after a school year', () => {
    const next = nextMathCenterTerm(makeTerm())

    expect(next).toEqual({ kind: 'camp', grade: 5 })
    expect(next && nextTermDisplayName(next)).toBe('5 класс · Лагерь')
  })

  it('selects the next grade school year after camp', () => {
    expect(nextMathCenterTerm(makeTerm({ kind: 'camp', display_name: '5 класс · Лагерь' }))).toEqual({
      kind: 'academic',
      grade: 6,
    })
  })

  it('shows the school-year rollover starting June 1', () => {
    const term = makeTerm()

    expect(shouldShowTermRollover(term, new Date(2026, 4, 31))).toBe(false)
    expect(shouldShowTermRollover(term, new Date(2026, 5, 1))).toBe(true)
  })

  it('shows the camp rollover after August 20', () => {
    const term = makeTerm({ kind: 'camp', display_name: '5 класс · Лагерь' })

    expect(shouldShowTermRollover(term, new Date(2026, 7, 20, 23, 59))).toBe(false)
    expect(shouldShowTermRollover(term, new Date(2026, 7, 21))).toBe(true)
  })

  it('does not show rollover for archived or final periods', () => {
    expect(shouldShowTermRollover(makeTerm({ is_active: false }), new Date(2026, 6, 1))).toBe(false)
    expect(nextMathCenterTerm(makeTerm({ kind: 'academic', grade: 11 }))).toBeNull()
    expect(nextMathCenterTerm(makeTerm({ kind: 'camp', grade: 11 }))).toBeNull()
  })
})
