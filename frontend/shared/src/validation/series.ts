// zod schema mirroring the backend's series create/update validation
// (internal/handlers/mathcenter). Shared so web and native forms enforce
// identical client-side rules and infer their value types from one place. Keep
// in sync with the Go validators.

import { z } from 'zod'

const problemNumber = z
  .number({ message: 'Введите число' })
  .int('Целое число')
  .min(0, 'Минимум 0')
  .max(100000, 'Максимум 100000')

// MAX_SUBPARTS mirrors the backend MaxSubproblemsPerProblem (the Latin alphabet).
export const MAX_SUBPARTS = 26

const seriesProblem = z.object({
  // Echoed back for existing problems so the backend keeps them in place
  // (diff-based update); absent for newly-added problems.
  id: z.number().int().positive().optional(),
  number: problemNumber,
  // Count of lettered subparts (a, b, c …). 0 means a single-part problem.
  subproblem_count: z
    .number({ message: 'Введите число' })
    .int('Целое число')
    .min(0, 'Минимум 0')
    .max(MAX_SUBPARTS, 'Максимум ' + MAX_SUBPARTS),
})

// createSeriesSchema validates the FORM values for both POST (create) and PUT
// (update). due_at is the raw datetime-local string from the form; the backend
// parses it as ISO, so we only require it to be non-empty here. The problems
// array may be empty — the create wizard uploads the statement first and adds
// problems in a later step.
export const createSeriesSchema = z
  .object({
    number: problemNumber,
    name: z
      .string()
      .trim()
      .min(1, 'Введите название')
      .max(200, 'Максимум 200 символов'),
    due_at: z.string().trim().min(1, 'Укажите срок сдачи'),
    problems: z.array(seriesProblem),
  })
  .refine(
    (v) => {
      const numbers = v.problems.map((p) => p.number)
      return new Set(numbers).size === numbers.length
    },
    { message: 'Номера задач не должны повторяться', path: ['problems'] },
  )
export type CreateSeriesValues = z.infer<typeof createSeriesSchema>

// --- Wire body ---------------------------------------------------------------

// SeriesProblemBody / CreateSeriesBody are what the backend actually receives.
export interface SeriesProblemBody {
  id?: number
  number: number
  subproblem_count: number
}

export interface CreateSeriesBody {
  number: number
  name: string
  due_at: string
  problems: SeriesProblemBody[]
}

// toSeriesBody converts validated form values into the wire body. `dueAtISO` is
// the form's local datetime converted to RFC3339 by the caller.
export function toSeriesBody(
  values: CreateSeriesValues,
  dueAtISO: string,
): CreateSeriesBody {
  return {
    number: values.number,
    name: values.name,
    due_at: dueAtISO,
    problems: values.problems.map((p) => ({
      id: p.id,
      number: p.number,
      subproblem_count: p.subproblem_count,
    })),
  }
}
