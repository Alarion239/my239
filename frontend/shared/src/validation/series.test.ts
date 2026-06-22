import { describe, expect, it } from 'vitest'
import { createSeriesSchema, toSeriesBody } from './series'

function validInput() {
  return {
    number: 1,
    name: 'Серия 1',
    due_at: '2026-09-01T18:00',
    problems: [
      { number: 1, subproblem_count: 3 },
      { number: 2, subproblem_count: 0 }, // single-part problem
    ],
  }
}

describe('createSeriesSchema', () => {
  it('accepts a valid series', () => {
    expect(createSeriesSchema.safeParse(validInput()).success).toBe(true)
  })

  it('accepts an optional problem id (round-tripped for diff updates)', () => {
    const result = createSeriesSchema.safeParse({
      ...validInput(),
      problems: [{ id: 42, number: 1, subproblem_count: 3 }],
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.problems[0].id).toBe(42)
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

  it('accepts a series with no problems (statement-first creation)', () => {
    expect(
      createSeriesSchema.safeParse({ ...validInput(), problems: [] }).success,
    ).toBe(true)
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

  it('rejects a subproblem count above the alphabet', () => {
    expect(
      createSeriesSchema.safeParse({
        ...validInput(),
        problems: [{ number: 1, subproblem_count: 27 }],
      }).success,
    ).toBe(false)
  })

  it('rejects a negative subproblem count', () => {
    expect(
      createSeriesSchema.safeParse({
        ...validInput(),
        problems: [{ number: 1, subproblem_count: -1 }],
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

describe('toSeriesBody', () => {
  it('passes counts and ids straight through with the ISO due date', () => {
    const body = toSeriesBody(
      {
        number: 4,
        name: 'Серия 4',
        due_at: '2026-09-01T18:00',
        problems: [
          { id: 7, number: 1, subproblem_count: 3 },
          { number: 2, subproblem_count: 0 },
        ],
      },
      '2026-09-01T15:00:00.000Z',
    )
    expect(body).toEqual({
      number: 4,
      name: 'Серия 4',
      due_at: '2026-09-01T15:00:00.000Z',
      problems: [
        { id: 7, number: 1, subproblem_count: 3 },
        { id: undefined, number: 2, subproblem_count: 0 },
      ],
    })
  })

  it('serialises an empty problem set', () => {
    const body = toSeriesBody(
      { number: 4, name: 'x', due_at: 'x', problems: [] },
      '2026-09-01T15:00:00.000Z',
    )
    expect(body.problems).toEqual([])
  })
})
