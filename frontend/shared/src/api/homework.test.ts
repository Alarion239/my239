// Unit tests for the homework-domain pure helpers. The HTTP clients
// themselves take an injected `authedFetch`, so they're trivially
// testable elsewhere (web's series.test.ts covers that pattern); this
// suite focuses on the pieces that have no I/O.

import {describe, expect, it} from 'vitest'
import {
    computeGranularCounts,
    eventKindLabel,
    isClosed,
    ruPlural,
    statusLabel,
    type RollupProblem,
    type ThreadStatus,
    userNameFromThread,
    type ThreadView,
} from './homework'

describe('ruPlural', () => {
    it('returns singular for 1, 21, 101 (n%10===1 and not in teens)', () => {
        expect(ruPlural(1, 'sg', 'pl')).toBe('sg')
        expect(ruPlural(21, 'sg', 'pl')).toBe('sg')
        expect(ruPlural(101, 'sg', 'pl')).toBe('sg')
    })

    it('returns plural for 0 (zero is plural in dropped-noun usage)', () => {
        expect(ruPlural(0, 'sg', 'pl')).toBe('pl')
    })

    it('returns plural for 2..4 and 22..24', () => {
        for (const n of [2, 3, 4, 22, 23, 24]) {
            expect(ruPlural(n, 'sg', 'pl')).toBe('pl')
        }
    })

    it('returns plural for the teens 11..19 and for 5..20', () => {
        for (const n of [5, 6, 11, 12, 13, 14, 15, 19, 20]) {
            expect(ruPlural(n, 'sg', 'pl')).toBe('pl')
        }
    })

    it('matches the "Не решена / Не решены" examples from the spec', () => {
        const sg = 'Не решена'
        const pl = 'Не решены'
        expect(ruPlural(0, sg, pl)).toBe(pl)
        expect(ruPlural(1, sg, pl)).toBe(sg)
        expect(ruPlural(2, sg, pl)).toBe(pl)
        expect(ruPlural(5, sg, pl)).toBe(pl)
    })

    it('handles negative values via |n| (defensive)', () => {
        // Counts shouldn't be negative, but the helper shouldn't blow up.
        expect(ruPlural(-1, 'sg', 'pl')).toBe('sg')
        expect(ruPlural(-2, 'sg', 'pl')).toBe('pl')
    })
})

describe('statusLabel', () => {
    it('uses the singular-feminine forms agreeing with "задача"', () => {
        expect(statusLabel('accepted')).toBe('Принята')
        expect(statusLabel('rejected')).toBe('Отклонена')
        expect(statusLabel('submitted')).toBe('Проверяется')
        expect(statusLabel('appealed')).toBe('Проверяется')
        expect(statusLabel('ungraded')).toBe('Не решена')
    })
})

describe('eventKindLabel', () => {
    it('renders graded events according to verdict', () => {
        expect(eventKindLabel('graded', 'accepted')).toBe('Принято')
        expect(eventKindLabel('graded', 'rejected')).toBe('Отклонено')
    })
    it('labels other event kinds', () => {
        expect(eventKindLabel('submitted')).toBe('Решение')
        expect(eventKindLabel('appealed')).toBe('Апелляция')
        expect(eventKindLabel('retracted')).toBe('Оценка отозвана')
        expect(eventKindLabel('claimed')).toBe('Взято в проверку')
        expect(eventKindLabel('released')).toBe('Освобождено')
    })
})

describe('computeGranularCounts', () => {
    function problem(statuses: ThreadStatus[]): RollupProblem {
        return {
            problem_id: 1,
            problem_number: 1,
            problem_display: 'Задача 1',
            subproblems: statuses.map((current_status, i) => ({
                subproblem_id: i,
                subproblem_label: String.fromCharCode(97 + i),
                thread_id: current_status === 'ungraded' ? 0 : 100 + i,
                current_status,
            })),
        }
    }

    it('returns zero counts for empty input', () => {
        expect(computeGranularCounts([])).toEqual({
            accepted: 0, rejected: 0, checking: 0, not_solved: 0, total: 0,
        })
    })

    it('counts each status into the right bucket', () => {
        const counts = computeGranularCounts([
            problem(['accepted', 'rejected', 'submitted', 'appealed', 'ungraded']),
        ])
        expect(counts).toEqual({
            accepted: 1,
            rejected: 1,
            checking: 2,     // submitted + appealed both → checking
            not_solved: 1,   // ungraded
            total: 5,
        })
    })

    it('aggregates across multiple problems', () => {
        const counts = computeGranularCounts([
            problem(['accepted', 'accepted']),
            problem(['rejected', 'ungraded']),
            problem(['submitted']),
        ])
        expect(counts).toMatchObject({accepted: 2, rejected: 1, checking: 1, not_solved: 1, total: 5})
    })
})

describe('isClosed', () => {
    it('treats null/undefined as open (no deadline)', () => {
        expect(isClosed(null)).toBe(false)
        expect(isClosed(undefined)).toBe(false)
    })

    it('returns true when the deadline has passed', () => {
        const past = new Date(Date.now() - 60 * 1000).toISOString()
        expect(isClosed(past)).toBe(true)
    })

    it('returns false when the deadline is in the future', () => {
        const future = new Date(Date.now() + 60 * 1000).toISOString()
        expect(isClosed(future)).toBe(false)
    })

    it('returns false for unparseable strings (fail-open, never trap a user)', () => {
        expect(isClosed('not a date')).toBe(false)
    })
})

describe('userNameFromThread', () => {
    const thread: ThreadView = {
        id: 1,
        student_user_id: 7,
        subproblem_id: 100,
        series_id: 200,
        series_due_at: new Date().toISOString(),
        math_center_id: 42,
        current_status: 'submitted',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        events: [],
        users: {'7': 'Аня Иванова', '3': 'Иван Петрович'},
    }

    it('looks up names by stringified id', () => {
        expect(userNameFromThread(thread, 7)).toBe('Аня Иванова')
        expect(userNameFromThread(thread, 3)).toBe('Иван Петрович')
    })

    it('returns empty string for null/undefined', () => {
        expect(userNameFromThread(thread, null)).toBe('')
        expect(userNameFromThread(thread, undefined)).toBe('')
    })

    it('returns "неизвестно" when the id is missing from the map', () => {
        expect(userNameFromThread(thread, 999)).toBe('неизвестно')
    })
})
