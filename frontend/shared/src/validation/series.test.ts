import { describe, expect, it } from 'vitest'
import { countToSubparts, createSeriesSchema, subpartsToCount } from './series'

function validInput() {
  return {
    number: 1,
    name: 'Серия 1',
    due_at: '2026-09-01T18:00',
    problems: [
      { number: 1, subparts: 'c' }, // 3 subparts a,b,c
      { number: 2, subparts: '' }, // single-part problem
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
      problems: [{ id: 42, number: 1, subparts: '3' }],
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

  it('rejects a series with no problems', () => {
    expect(
      createSeriesSchema.safeParse({ ...validInput(), problems: [] }).success,
    ).toBe(false)
  })

  it('rejects duplicate problem numbers', () => {
    const result = createSeriesSchema.safeParse({
      ...validInput(),
      problems: [
        { number: 1, subparts: 'a' },
        { number: 1, subparts: 'b' },
      ],
    })
    expect(result.success).toBe(false)
  })

  it('rejects an unparseable subparts value', () => {
    expect(
      createSeriesSchema.safeParse({
        ...validInput(),
        problems: [{ number: 1, subparts: 'zz' }],
      }).success,
    ).toBe(false)
  })

  it('rejects a non-integer problem number', () => {
    expect(
      createSeriesSchema.safeParse({
        ...validInput(),
        problems: [{ number: 1.5, subparts: 'a' }],
      }).success,
    ).toBe(false)
  })

  it('rejects a series number above 100000', () => {
    expect(
      createSeriesSchema.safeParse({ ...validInput(), number: 100001 }).success,
    ).toBe(false)
  })
})

// The "subparts" field accepts a count OR the last Latin letter; empty = no
// subparts. Round-tripping count↔letter must use Latin letters (a..z), never
// Cyrillic.
describe('subpartsToCount', () => {
  it('treats empty as zero (single-part problem)', () => {
    expect(subpartsToCount('')).toBe(0)
    expect(subpartsToCount('   ')).toBe(0)
  })

  it('parses a plain count', () => {
    expect(subpartsToCount('0')).toBe(0)
    expect(subpartsToCount('3')).toBe(3)
    expect(subpartsToCount('26')).toBe(26)
  })

  it('parses a Latin last-letter into its position', () => {
    expect(subpartsToCount('a')).toBe(1)
    expect(subpartsToCount('c')).toBe(3)
    expect(subpartsToCount('C')).toBe(3) // case-insensitive
    expect(subpartsToCount('z')).toBe(26)
  })

  it('rejects out-of-range counts and bad input', () => {
    expect(subpartsToCount('27')).toBeNull()
    expect(subpartsToCount('ab')).toBeNull()
    expect(subpartsToCount('3c')).toBeNull()
    // Cyrillic letters are not valid subpart labels.
    expect(subpartsToCount('а')).toBeNull() // Cyrillic 'а'
    expect(subpartsToCount('-')).toBeNull()
  })
})

describe('countToSubparts', () => {
  it('renders the last Latin letter, or empty for none', () => {
    expect(countToSubparts(0)).toBe('')
    expect(countToSubparts(1)).toBe('a')
    expect(countToSubparts(3)).toBe('c')
    expect(countToSubparts(26)).toBe('z')
  })

  it('round-trips with subpartsToCount', () => {
    for (let n = 0; n <= 26; n++) {
      expect(subpartsToCount(countToSubparts(n))).toBe(n)
    }
  })
})
