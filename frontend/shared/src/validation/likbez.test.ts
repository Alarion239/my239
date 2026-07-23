import { describe, expect, it } from 'vitest'
import { likbezDateFromISO, likbezSchema, russianLikbezDateToISO, todayLikbezDate } from './likbez'

const valid = {
  term_id: 7,
  number: 12,
  title: 'Графы и инварианты',
  held_on: '23-07-2026',
  description: 'Как выбирать инвариант для задачи.',
}

describe('likbezSchema', () => {
  it('accepts a complete lecture card', () => {
    expect(likbezSchema.safeParse(valid).success).toBe(true)
  })

  it('requires a period, title, calendar date, and description', () => {
    expect(likbezSchema.safeParse({ ...valid, term_id: 0 }).success).toBe(false)
    expect(likbezSchema.safeParse({ ...valid, title: '  ' }).success).toBe(false)
    expect(likbezSchema.safeParse({ ...valid, held_on: '2026-07-23' }).success).toBe(false)
    expect(likbezSchema.safeParse({ ...valid, held_on: '31-02-2026' }).success).toBe(false)
    expect(likbezSchema.safeParse({ ...valid, description: '' }).success).toBe(false)
  })

  it('converts UI dates to and from the API calendar-date format', () => {
    expect(russianLikbezDateToISO('23-07-2026')).toBe('2026-07-23')
    expect(likbezDateFromISO('2026-07-23')).toBe('23-07-2026')
    expect(todayLikbezDate(new Date(2026, 6, 23, 12))).toBe('23-07-2026')
  })
})
