import { z } from 'zod'

export const likbezSchema = z.object({
  term_id: z.number().int().positive('Выберите период'),
  number: z.number().int().min(1, 'Минимум 1').max(100000, 'Максимум 100000'),
  title: z.string().trim().min(1, 'Введите название').max(200, 'Максимум 200 символов'),
  held_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Укажите дату'),
  description: z.string().trim().min(1, 'Добавьте краткое описание').max(4000, 'Максимум 4000 символов'),
})

export type LikbezValues = z.infer<typeof likbezSchema>

export interface CreateLikbezBody {
  term_id: number
  title: string
  held_on: string
  description: string
}

export type UpdateLikbezBody = LikbezValues
