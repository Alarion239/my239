import { describe, expect, it } from 'vitest'
import {
  createGroupSchema,
  createMathCenterSchema,
  createTokenSchema,
} from './admin'

describe('createTokenSchema', () => {
  it('accepts a valid token request', () => {
    const result = createTokenSchema.safeParse({
      description: 'Class of 2025',
      max_uses: 10,
      expires_in_hours: 48,
    })
    expect(result.success).toBe(true)
  })

  it('trims the description', () => {
    const result = createTokenSchema.safeParse({
      description: '  trimmed  ',
      max_uses: 1,
      expires_in_hours: 1,
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.description).toBe('trimmed')
  })

  it('rejects an empty description', () => {
    expect(
      createTokenSchema.safeParse({
        description: '   ',
        max_uses: 1,
        expires_in_hours: 1,
      }).success,
    ).toBe(false)
  })

  it('rejects a description over 255 chars', () => {
    expect(
      createTokenSchema.safeParse({
        description: 'a'.repeat(256),
        max_uses: 1,
        expires_in_hours: 1,
      }).success,
    ).toBe(false)
  })

  it('rejects max_uses below 1', () => {
    expect(
      createTokenSchema.safeParse({
        description: 'ok',
        max_uses: 0,
        expires_in_hours: 1,
      }).success,
    ).toBe(false)
  })

  it('rejects a non-integer max_uses', () => {
    expect(
      createTokenSchema.safeParse({
        description: 'ok',
        max_uses: 1.5,
        expires_in_hours: 1,
      }).success,
    ).toBe(false)
  })

  it('rejects expires_in_hours below 1', () => {
    expect(
      createTokenSchema.safeParse({
        description: 'ok',
        max_uses: 1,
        expires_in_hours: 0,
      }).success,
    ).toBe(false)
  })
})

describe('createMathCenterSchema', () => {
  it('accepts a valid graduation year', () => {
    expect(
      createMathCenterSchema.safeParse({ graduation_year: 2025 }).success,
    ).toBe(true)
  })

  it('accepts the lower and upper bounds', () => {
    expect(
      createMathCenterSchema.safeParse({ graduation_year: 1900 }).success,
    ).toBe(true)
    expect(
      createMathCenterSchema.safeParse({ graduation_year: 2100 }).success,
    ).toBe(true)
  })

  it('rejects a year below 1900', () => {
    expect(
      createMathCenterSchema.safeParse({ graduation_year: 1899 }).success,
    ).toBe(false)
  })

  it('rejects a year above 2100', () => {
    expect(
      createMathCenterSchema.safeParse({ graduation_year: 2101 }).success,
    ).toBe(false)
  })

  it('rejects a non-integer year', () => {
    expect(
      createMathCenterSchema.safeParse({ graduation_year: 2025.5 }).success,
    ).toBe(false)
  })
})

describe('createGroupSchema', () => {
  it('accepts a valid name', () => {
    expect(createGroupSchema.safeParse({ name: 'Group A' }).success).toBe(true)
  })

  it('trims the name', () => {
    const result = createGroupSchema.safeParse({ name: '  Group A  ' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.name).toBe('Group A')
  })

  it('rejects an empty name', () => {
    expect(createGroupSchema.safeParse({ name: '   ' }).success).toBe(false)
  })

  it('rejects a name over 50 chars', () => {
    expect(
      createGroupSchema.safeParse({ name: 'a'.repeat(51) }).success,
    ).toBe(false)
  })
})
