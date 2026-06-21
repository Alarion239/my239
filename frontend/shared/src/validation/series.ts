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

// subpartsToCount parses the "subparts" form field, which accepts EITHER a count
// ("3") OR the last subproblem's Latin letter ("c" → 3). Empty/"0" means a
// single-part problem (no lettered subparts). Returns null when unparseable so
// the schema can reject it.
export function subpartsToCount(raw: string): number | null {
  const s = raw.trim()
  if (s === '') return 0
  if (/^\d+$/.test(s)) {
    const n = Number(s)
    return n >= 0 && n <= MAX_SUBPARTS ? n : null
  }
  if (/^[a-zA-Z]$/.test(s)) {
    return s.toLowerCase().charCodeAt(0) - 96 // a=1 … z=26
  }
  return null
}

// countToSubparts renders a count back into the field's preferred display: the
// last Latin letter (3 → "c"), or "" for a single-part problem.
export function countToSubparts(count: number): string {
  if (count <= 0) return ''
  if (count > MAX_SUBPARTS) return String(count)
  return String.fromCharCode(96 + count) // 1 → "a", 3 → "c"
}

const seriesProblem = z.object({
  // Echoed back for existing problems so the backend keeps them in place
  // (diff-based update); absent for newly-added problems.
  id: z.number().int().positive().optional(),
  number: problemNumber,
  subparts: z
    .string()
    .trim()
    .refine((s) => subpartsToCount(s) !== null, 'Число 0–26 или буква a–z'),
})

// createSeriesSchema validates the FORM values for both POST (create) and PUT
// (update). due_at is the raw datetime-local string from the form; the backend
// parses it as ISO, so we only require it to be non-empty here.
export const createSeriesSchema = z
  .object({
    number: problemNumber,
    name: z
      .string()
      .trim()
      .min(1, 'Введите название')
      .max(200, 'Максимум 200 символов'),
    due_at: z.string().trim().min(1, 'Укажите срок сдачи'),
    problems: z.array(seriesProblem).min(1, 'Добавьте хотя бы одну задачу'),
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

// SeriesProblemBody / CreateSeriesBody are what the backend actually receives:
// the dual-format `subparts` is resolved to a numeric `subproblem_count`.
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

// toSeriesBody converts validated form values into the wire body (resolving the
// subparts field to a count). `dueAtISO` is the form's local datetime converted
// to RFC3339 by the caller.
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
      subproblem_count: subpartsToCount(p.subparts) ?? 0,
    })),
  }
}
