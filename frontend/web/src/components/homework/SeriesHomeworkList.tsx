// SeriesHomeworkList is the student-facing series index: every published
// series in their center as a clickable card with the title on the left
// and progress badges on the right. Used inside the unified Матцентр
// page so students see "what's due, how am I doing" without a separate
// Домашка trip.
//
// We fetch the per-series rollup counts in parallel — there's a handful
// of series per center, so N+1 calls are cheap and avoid teaching the
// backend a new "all-series-with-counts" endpoint.

import {useCallback, useEffect, useState} from 'react'
import {useNavigate} from 'react-router-dom'
import {APIErrorImpl} from '../../api'
import {computeGranularCounts, getMyRollup, ruPlural, type GranularCounts} from '../../api/homework'
import {listSeriesForCenter, type Series} from '../../api/series'
import {useAuth} from '../../auth'
import {formatDateTime} from '../../lib/format'
import {Card, ErrorBanner, Heading, Subheading} from '../ui'
import {ProgressBadges} from './ProgressBadges'

interface SeriesWithCounts extends Series {
    counts: GranularCounts | null
}

export function SeriesHomeworkList({centerID}: {centerID: number}) {
    const {authedFetch} = useAuth()
    const navigate = useNavigate()
    const [items, setItems] = useState<SeriesWithCounts[] | null>(null)
    const [error, setError] = useState<string | null>(null)

    const load = useCallback(async () => {
        try {
            const raw = await listSeriesForCenter(authedFetch, centerID)
            const published = raw.filter(s => s.published).sort((a, b) => b.number - a.number)
            const withCounts = await Promise.all(published.map(async s => {
                try {
                    const r = await getMyRollup(authedFetch, s.id)
                    return {...s, counts: computeGranularCounts(r.problems)} as SeriesWithCounts
                } catch {
                    return {...s, counts: null} as SeriesWithCounts
                }
            }))
            setItems(withCounts)
        } catch (e) {
            setError(e instanceof APIErrorImpl ? e.message : 'Не удалось загрузить серии')
        }
    }, [authedFetch, centerID])

    useEffect(() => {
        void load()
    }, [load])

    if (error) {
        return <Card><ErrorBanner message={error}/></Card>
    }
    if (!items) {
        return <Card><Subheading>Загрузка серий…</Subheading></Card>
    }
    if (items.length === 0) {
        return <Card><Subheading>Серий пока нет.</Subheading></Card>
    }
    return (
        <div className="flex flex-col gap-3">
            {items.map(item => (
                <SeriesRow
                    key={item.id}
                    series={item}
                    onOpen={() => navigate(`/homework/series/${item.id}`)}
                />
            ))}
        </div>
    )
}

function SeriesRow({series, onOpen}: {series: SeriesWithCounts; onOpen: () => void}) {
    const overdue = !!series.due_at && new Date(series.due_at).getTime() < Date.now()
    // Overdue psets get a muted look + a compact "X из Y" summary
    // instead of three separate badges. We still surface in-progress
    // count when > 0 (graders may finish after the deadline); rejected
    // count is intentionally hidden so an old pset's wall of red
    // doesn't dominate the dashboard.
    const cardClass = overdue
        ? 'bg-[#f3f4f6] border-[#e5e7eb] hover:bg-[#eaecef]'
        : 'bg-card border-card-border hover:bg-[#f9fafb]'
    return (
        <button
            type="button"
            onClick={onOpen}
            className={`w-full text-left rounded-xl border p-[18px] transition-colors ${cardClass}`}
        >
            <div className="flex items-center justify-between gap-4">
                <div className="flex-1 min-w-0">
                    <Heading>{series.display_name}</Heading>
                    <p className={`text-[13px] mt-0.5 ${overdue ? 'text-[#9ca3af]' : 'text-muted'}`}>
                        Срок: {formatDateTime(series.due_at)}
                    </p>
                </div>
                {series.counts ? (
                    overdue
                        ? <OverdueSummary counts={series.counts}/>
                        : <ProgressBadges counts={series.counts}/>
                ) : null}
            </div>
        </button>
    )
}

// OverdueSummary renders the simplified "X из Y решено" form for closed
// psets. We deliberately omit the rejected count and "не решена" — the
// deadline has passed so the student can't act on either. "Проверяется"
// stays visible because graders may still finish reviewing.
function OverdueSummary({counts}: {counts: GranularCounts}) {
    const solvedWord = ruPlural(counts.accepted, 'решена', 'решены')
    return (
        <div className="flex flex-col items-end">
            <p className="text-base font-bold text-[#374151]">
                {counts.accepted}
                <span className="text-sm font-medium text-[#6b7280]"> из {counts.total} {solvedWord}</span>
            </p>
            {counts.checking > 0 ? (
                <p className="text-xs font-medium text-[#92400e] mt-0.5">
                    {counts.checking} {ruPlural(counts.checking, 'проверяется', 'проверяются')}
                </p>
            ) : null}
        </div>
    )
}
