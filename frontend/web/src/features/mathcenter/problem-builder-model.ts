// Model types and helpers for the problem builder, kept separate from the
// component so the .tsx file only exports components (clean fast-refresh).

// ProblemDraft is one problem in the builder: a positional number (always
// 1..N), its subproblem count, and — for an existing problem being edited — the
// backend id so the diff-update keeps its threads/разборы in place.
export interface ProblemDraft {
  id?: number
  number: number
  subproblem_count: number
}

// Slider bounds for the number of problems. A session has at most a dozen
// problems; the default of 8 matches a typical series.
export const MIN_PROBLEMS = 1
export const MAX_PROBLEMS = 12
export const DEFAULT_PROBLEMS = 8

// seedProblems builds a fresh list of `n` single-part problems numbered 1..n.
export function seedProblems(n: number): ProblemDraft[] {
  return Array.from({ length: n }, (_, i) => ({ number: i + 1, subproblem_count: 0 }))
}
