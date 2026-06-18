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

const seriesProblem = z.object({
  number: problemNumber,
  subproblem_count: z
    .number({ message: 'Введите число' })
    .int('Целое число')
    .min(0, 'Минимум 0')
    .max(10, 'Максимум 10'),
})

// createSeriesSchema validates the body for both POST (create) and PUT (update)
// of a series. due_at is the raw datetime-local string from the form; the
// backend parses it as ISO, so we only require it to be non-empty here.
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
