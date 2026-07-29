// zod schemas mirroring the backend's admin validation (internal/handlers/admin).
// Shared so web and native forms enforce identical client-side rules and infer
// their value types from one place. Keep in sync with the Go validators.

import { z } from 'zod'

export const createTokenSchema = z.object({
  description: z
    .string()
    .trim()
    .min(1, 'Введите описание')
    .max(255, 'Максимум 255 символов'),
  max_uses: z
    .number({ message: 'Введите число' })
    .int('Целое число')
    .min(1, 'Минимум 1'),
  expires_in_hours: z
    .number({ message: 'Введите число' })
    .int('Целое число')
    .min(1, 'Минимум 1'),
})
export type CreateTokenValues = z.infer<typeof createTokenSchema>

export const createMathCenterSchema = z.object({
  graduation_year: z
    .number({ message: 'Введите число' })
    .int('Целое число')
    .min(1900, 'Минимум 1900')
    .max(2100, 'Максимум 2100'),
  term_kind: z.enum(['academic', 'camp'], {
    message: 'Выберите учебный период',
  }),
  term_grade: z
    .number({ message: 'Выберите учебный период' })
    .int('Выберите учебный период')
    .min(5, 'Выберите класс с 5 по 11')
    .max(11, 'Выберите класс с 5 по 11'),
}).superRefine((value, ctx) => {
  if (value.term_kind === 'camp' && value.term_grade === 11) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['term_grade'],
      message: 'После 11 класса лагерь недоступен',
    })
  }
})
export type CreateMathCenterValues = z.infer<typeof createMathCenterSchema>

export const createGroupSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Введите название')
    .max(50, 'Максимум 50 символов'),
})
export type CreateGroupValues = z.infer<typeof createGroupSchema>
