// Model types and helpers for the problem builder, kept separate from the
// component so the .tsx file only exports components (clean fast-refresh).

// ProblemDraft is one problem in the builder: number 0 is the optional
// Упражнение, positive numbers are regular positional problems, and the id is
// preserved for existing problems so diff updates keep their threads/разборы.
export interface ProblemDraft {
  id?: number
  number: number
  subproblem_count: number
}

// A draft series can start empty and grow one neutral card at a time.
export const MAX_PROBLEMS = 12

// seedProblems builds a fresh list of `n` single-part problems numbered 1..n.
export function seedProblems(n: number): ProblemDraft[] {
  return Array.from({ length: n }, (_, i) => ({ number: i + 1, subproblem_count: 0 }))
}
