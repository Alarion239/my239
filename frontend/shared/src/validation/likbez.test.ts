import { describe, expect, it } from 'vitest'
import { likbezSchema } from './likbez'

const valid = {
  term_id: 7,
  number: 12,
  title: 'Графы и инварианты',
  held_on: '2026-07-23',
  description: 'Как выбирать инвариант для задачи.',
}

describe('likbezSchema', () => {
  it('accepts a complete lecture card', () => {
    expect(likbezSchema.safeParse(valid).success).toBe(true)
  })

  it('requires a period, title, calendar date, and description', () => {
    expect(likbezSchema.safeParse({ ...valid, term_id: 0 }).success).toBe(false)
    expect(likbezSchema.safeParse({ ...valid, title: '  ' }).success).toBe(false)
    expect(likbezSchema.safeParse({ ...valid, held_on: '23.07.2026' }).success).toBe(false)
    expect(likbezSchema.safeParse({ ...valid, description: '' }).success).toBe(false)
  })
})
