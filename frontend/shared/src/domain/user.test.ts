import { describe, expect, it } from 'vitest'
import { fullName, initials, primaryRole, roleLabel } from './user'

describe('fullName', () => {
  it('joins first, middle, last', () => {
    expect(fullName({ first_name: 'Иван', middle_name: 'Петрович', last_name: 'Сидоров' })).toBe(
      'Иван Петрович Сидоров',
    )
  })

  it('skips an absent or blank middle name', () => {
    expect(fullName({ first_name: 'Иван', middle_name: null, last_name: 'Сидоров' })).toBe('Иван Сидоров')
    expect(fullName({ first_name: 'Иван', middle_name: '  ', last_name: 'Сидоров' })).toBe('Иван Сидоров')
  })
})

describe('initials', () => {
  it('returns two uppercase Cyrillic letters', () => {
    expect(initials({ first_name: 'иван', last_name: 'сидоров' })).toBe('ИС')
  })

  it('falls back to ? when empty', () => {
    expect(initials({ first_name: '', last_name: '' })).toBe('?')
  })
})

describe('primaryRole / roleLabel', () => {
  it('prefers admin, then math center, then member', () => {
    expect(primaryRole({ is_admin: true, is_math_center: true })).toBe('admin')
    expect(primaryRole({ is_admin: false, is_math_center: true })).toBe('math_center')
    expect(primaryRole({ is_admin: false, is_math_center: false })).toBe('member')
  })

  it('labels each role in Russian', () => {
    expect(roleLabel('admin')).toBe('Администратор')
    expect(roleLabel('math_center')).toBe('Матцентр')
    expect(roleLabel('member')).toBe('Участник')
  })
})
