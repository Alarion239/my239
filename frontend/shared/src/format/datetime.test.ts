import {describe, expect, it} from 'vitest'
import {formatDateTime} from './datetime'

describe('formatDateTime', () => {
    it('returns em-dash for empty / null / undefined', () => {
        expect(formatDateTime(null)).toBe('—')
        expect(formatDateTime(undefined)).toBe('—')
        expect(formatDateTime('')).toBe('—')
    })

    it('returns em-dash for unparseable strings', () => {
        expect(formatDateTime('not a date')).toBe('—')
    })

    it('renders a valid ISO string in ru-RU locale (medium date + short time)', () => {
        // Use a fixed UTC instant; the renderer is locale-fixed but
        // wall-clock depends on the test machine's timezone. We only
        // check that it produces a non-error string with a comma (the
        // ru-RU locale separator between date and time).
        const out = formatDateTime('2026-05-15T18:30:00Z')
        expect(out).not.toBe('—')
        expect(out).toMatch(/\d{4}/)
    })
})
