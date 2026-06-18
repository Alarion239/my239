import { describe, expect, it } from 'vitest'
import { createSeriesSchema } from './series'

function validInput() {
  return {
    number: 1,
    name: 'Серия 1',
    due_at: '2026-09-01T18:00',
    problems: [
      { number: 1, subproblem_count: 3 },
      { number: 2, subproblem_count: 0 },
    ],
  }
}

describe('createSeriesSchema', () => {
  it('accepts a valid series', () => {
    expect(createSeriesSchema.safeParse(validInput()).success).toBe(true)
  })

  it('trims the name', () => {
    const result = createSeriesSchema.safeParse({
      ...validInput(),
      name: '  Серия 1  ',
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.name).toBe('Серия 1')
  })

  it('rejects an empty name', () => {
    expect(
      createSeriesSchema.safeParse({ ...validInput(), name: '   ' }).success,
    ).toBe(false)
  })

  it('rejects an empty due_at', () => {
    expect(
      createSeriesSchema.safeParse({ ...validInput(), due_at: '' }).success,
    ).toBe(false)
  })

  it('rejects a series with no problems', () => {
    expect(
      createSeriesSchema.safeParse({ ...validInput(), problems: [] }).success,
    ).toBe(false)
  })

  it('rejects duplicate problem numbers', () => {
    const result = createSeriesSchema.safeParse({
      ...validInput(),
      problems: [
        { number: 1, subproblem_count: 1 },
        { number: 1, subproblem_count: 2 },
      ],
    })
    expect(result.success).toBe(false)
  })

  it('rejects subproblem_count above 10', () => {
    expect(
      createSeriesSchema.safeParse({
        ...validInput(),
        problems: [{ number: 1, subproblem_count: 11 }],
      }).success,
    ).toBe(false)
  })

  it('rejects a non-integer problem number', () => {
    expect(
      createSeriesSchema.safeParse({
        ...validInput(),
        problems: [{ number: 1.5, subproblem_count: 1 }],
      }).success,
    ).toBe(false)
  })

  it('rejects a series number above 100000', () => {
    expect(
      createSeriesSchema.safeParse({ ...validInput(), number: 100001 }).success,
    ).toBe(false)
  })
})
