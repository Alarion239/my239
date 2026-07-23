import { z } from 'zod'

const russianDatePattern = /^(\d{2})-(\d{2})-(\d{4})$/

// The UI uses the Russian DD-MM-YYYY convention, while the API stores calendar
// dates in ISO YYYY-MM-DD form.
export function russianLikbezDateToISO(value: string): string | null {
  const match = russianDatePattern.exec(value)
  if (!match) return null

  const day = Number(match[1])
  const month = Number(match[2])
  const year = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null

  return match[3] + '-' + match[2] + '-' + match[1]
}

export function likbezDateFromISO(value: string): string {
  const [year, month, day] = value.split('-')
  return year && month && day ? day + '-' + month + '-' + year : value
}

export function todayLikbezDate(now = new Date()): string {
  const day = String(now.getDate()).padStart(2, '0')
  const month = String(now.getMonth() + 1).padStart(2, '0')
  return day + '-' + month + '-' + now.getFullYear()
}

export const likbezSchema = z.object({
  term_id: z.number().int().positive('Выберите период'),
  number: z.number().int().min(1, 'Минимум 1').max(100000, 'Максимум 100000'),
  title: z.string().trim().min(1, 'Введите название').max(200, 'Максимум 200 символов'),
  held_on: z.string().refine((value) => russianLikbezDateToISO(value) !== null, 'Укажите дату в формате ДД-ММ-ГГГГ'),
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
