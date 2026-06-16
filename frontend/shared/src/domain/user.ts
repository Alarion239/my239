// Pure, platform-agnostic helpers for presenting a user. No I/O, no React, no
// DOM — safe to use from web, native, or tests.

import type { User } from '../types'

type NameParts = Pick<User, 'first_name' | 'middle_name' | 'last_name'>

// fullName joins the name parts, skipping an absent middle name. The product
// is Russian, so order is first [middle] last.
export function fullName(u: NameParts): string {
  return [u.first_name, u.middle_name, u.last_name]
    .filter((p): p is string => !!p && p.trim().length > 0)
    .join(' ')
}

// initials returns up to two uppercase letters for avatars, handling Cyrillic
// the same as Latin via toLocaleUpperCase. Falls back to '?' when empty.
export function initials(u: Pick<User, 'first_name' | 'last_name'>): string {
  const first = firstLetter(u.first_name)
  const last = firstLetter(u.last_name)
  const out = (first + last).toLocaleUpperCase('ru-RU')
  return out || '?'
}

function firstLetter(s: string | null | undefined): string {
  return s?.trim()?.[0] ?? ''
}

// Role is the coarse, top-level account kind used to gate navigation. Finer
// math-center membership (teacher vs. student, which centers) comes from
// /mathcenter/me and is layered on per module, not here.
export type Role = 'admin' | 'math_center' | 'member'

export function primaryRole(u: Pick<User, 'is_admin' | 'is_math_center'>): Role {
  if (u.is_admin) return 'admin'
  if (u.is_math_center) return 'math_center'
  return 'member'
}

// roleLabel renders a role as a human (Russian) badge label.
export function roleLabel(role: Role): string {
  switch (role) {
    case 'admin':
      return 'Администратор'
    case 'math_center':
      return 'Матцентр'
    case 'member':
      return 'Участник'
  }
}
