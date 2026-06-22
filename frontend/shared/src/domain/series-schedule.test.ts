import { describe, expect, it } from 'vitest'
import { nextMathcenterDueAt, toDatetimeLocalValue } from './series-schedule'

// mskParts reads the Moscow (UTC+3) calendar fields of an instant.
function mskParts(d: Date) {
  const s = new Date(d.getTime() + 3 * 60 * 60 * 1000)
  return { dow: s.getUTCDay(), h: s.getUTCHours(), m: s.getUTCMinutes() }
}

// isSessionInstant reports whether t lands exactly on a Wed/Sat 16:00 MSK.
function isSessionInstant(t: number): boolean {
  const p = mskParts(new Date(t))
  return (p.dow === 3 || p.dow === 6) && p.h === 16 && p.m === 0
}

describe('nextMathcenterDueAt', () => {
  it('returns the soonest strictly-future Wed/Sat 16:00 MSK', () => {
    const now = new Date('2026-06-22T09:30:00Z')
    const got = nextMathcenterDueAt(now)

    expect(got.getTime()).toBeGreaterThan(now.getTime())
    const p = mskParts(got)
    expect([3, 6]).toContain(p.dow)
    expect(p.h).toBe(16)
    expect(p.m).toBe(0)

    // Minimality: no session instant strictly between now and the result.
    for (let t = now.getTime() + 60_000; t < got.getTime(); t += 60_000) {
      expect(isSessionInstant(t)).toBe(false)
    }
  })

  it('anchors to 16:00 Moscow == 13:00 UTC', () => {
    const got = nextMathcenterDueAt(new Date('2026-06-22T00:00:00Z'))
    expect(got.getUTCHours()).toBe(13)
    expect(got.getUTCMinutes()).toBe(0)
  })

  it('skips a session that is exactly now (deadline must be in the future)', () => {
    // Find a Wednesday 16:00 MSK instant, use it as `now`.
    let wed = new Date('2026-06-01T13:00:00Z')
    while (mskParts(wed).dow !== 3) {
      wed = new Date(wed.getTime() + 24 * 60 * 60 * 1000)
    }
    expect(isSessionInstant(wed.getTime())).toBe(true)

    const got = nextMathcenterDueAt(wed)
    expect(got.getTime()).toBeGreaterThan(wed.getTime())
    // The very next session after a Wednesday is the following Saturday.
    expect(mskParts(got).dow).toBe(6)
  })

  it('jumps to next week when now is past Saturday session', () => {
    let sat = new Date('2026-06-01T17:00:00Z') // after 16:00 MSK
    while (mskParts(sat).dow !== 6) {
      sat = new Date(sat.getTime() + 24 * 60 * 60 * 1000)
    }
    const got = nextMathcenterDueAt(sat)
    expect(mskParts(got).dow).toBe(3) // next Wednesday
    expect(got.getTime()).toBeGreaterThan(sat.getTime())
  })
})

describe('toDatetimeLocalValue', () => {
  it('formats a Date as YYYY-MM-DDTHH:mm in local time', () => {
    // Construct via local fields so the expectation is timezone-independent.
    const d = new Date(2026, 5, 24, 16, 5)
    expect(toDatetimeLocalValue(d)).toBe('2026-06-24T16:05')
  })

  it('zero-pads month, day, hour, minute', () => {
    const d = new Date(2026, 0, 3, 9, 7)
    expect(toDatetimeLocalValue(d)).toBe('2026-01-03T09:07')
  })

  it('returns empty string for an invalid Date', () => {
    expect(toDatetimeLocalValue(new Date('nope'))).toBe('')
  })
})
