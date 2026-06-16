// zod schemas mirroring the backend's auth validation (internal/handlers/auth).
// Shared so web and native forms enforce identical client-side rules and infer
// their value types from one place. Keep in sync with the Go validators.

import { z } from 'zod'

// Username: 3-50 chars, alphanumeric only (matches register.go).
const username = z
  .string()
  .trim()
  .min(3, 'Минимум 3 символа')
  .max(50, 'Максимум 50 символов')
  .regex(/^[a-zA-Z0-9]+$/, 'Только латинские буквы и цифры')

export const loginSchema = z.object({
  username,
  // Login is intentionally permissive on password length for backward compat.
  password: z.string().min(1, 'Введите пароль').max(128),
})
export type LoginValues = z.infer<typeof loginSchema>

export const registerSchema = z.object({
  username,
  password: z
    .string()
    .min(8, 'Минимум 8 символов')
    .max(128, 'Максимум 128 символов'),
  invitation_token: z.string().trim().min(1, 'Введите код приглашения'),
  first_name: z.string().trim().min(1, 'Введите имя').max(255),
  middle_name: z.string().trim().max(255).optional(),
  last_name: z.string().trim().min(1, 'Введите фамилию').max(255),
})
export type RegisterValues = z.infer<typeof registerSchema>
