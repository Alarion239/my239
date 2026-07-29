import type { MathCenterTerm } from '@my239/shared'

export interface NextMathCenterTerm {
  kind: 'academic' | 'camp'
  grade: number
}

export function nextMathCenterTerm(term: MathCenterTerm | null): NextMathCenterTerm | null {
  if (!term?.is_active || term.grade == null) return null

  if (term.kind === 'academic' && term.grade < 11) {
    return { kind: 'camp', grade: term.grade }
  }
  if (term.kind === 'camp' && term.grade < 11) {
    return { kind: 'academic', grade: term.grade + 1 }
  }
  return null
}

export function shouldShowTermRollover(term: MathCenterTerm | null, now = new Date()): boolean {
  if (!nextMathCenterTerm(term)) return false
  if (term?.kind === 'academic') {
    return now >= new Date(now.getFullYear(), 5, 1)
  }
  return now >= new Date(now.getFullYear(), 7, 21)
}

export function nextTermDisplayName(nextTerm: NextMathCenterTerm): string {
  return nextTerm.kind === 'camp'
    ? `${nextTerm.grade} класс · Лагерь`
    : `${nextTerm.grade} класс`
}
