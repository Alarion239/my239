// zod schemas for the head-teacher management panel ("Управление"). Keep in
// sync with backend/internal/handlers/mathcenter/manage.go.

import { z } from 'zod'

// createInviteSchema validates the invite-creation form. A student invite must
// name a group; a teacher invite must not (the group field is ignored).
export const createInviteSchema = z
  .object({
    role: z.enum(['teacher', 'student']),
    group_id: z.number().int().positive().optional(),
    is_head_teacher: z.boolean().optional(),
    description: z.string().trim().max(255, 'Максимум 255 символов').optional(),
    max_uses: z
      .number({ message: 'Введите число' })
      .int('Целое число')
      .min(1, 'Минимум 1'),
    expires_in_hours: z
      .number({ message: 'Введите число' })
      .int('Целое число')
      .min(1, 'Минимум 1'),
  })
  .refine((v) => v.role !== 'student' || (v.group_id ?? 0) > 0, {
    message: 'Выберите группу',
    path: ['group_id'],
  })
export type CreateInviteValues = z.infer<typeof createInviteSchema>
