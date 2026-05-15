// SeriesHomeworkList is the student-facing series index: every published
// series in their center as a clickable card with the title on the left and
// progress badges on the right. Used inside the unified Матцентр page so
// students see "what's due, how am I doing" without a separate Домашка trip.
//
// We fetch the per-series rollup counts in parallel — there's a handful of
// series per center, so N+1 calls are cheap and avoid teaching the backend
// a new "all-series-with-counts" endpoint.

import {useCallback, useEffect, useState} from 'react'
import {Pressable, StyleSheet, Text, View} from 'react-native'
import {useNavigate} from 'react-router-dom'
import {APIErrorImpl} from '../../api'
import {computeGranularCounts, getMyRollup, ruPlural, type GranularCounts} from '../../api/homework'
import {listSeriesForCenter, type Series} from '../../api/series'
import {useAuth} from '../../auth'
import {formatDateTime} from '../../lib/format'
import {Card, colors, ErrorBanner, Heading, Subheading} from '../ui'
import {ProgressBadges} from './ProgressBadges'

interface SeriesWithCounts extends Series {
    // Granular counts computed from per-subproblem rollup (so we can
    // distinguish "проверяется" from "не решена" instead of lumping them).
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
            // Students see only published series; the backend already
            // filters for them, but we defensively re-filter and reverse
            // so the newest series sits at the top of the list.
            const published = raw.filter(s => s.published).sort((a, b) => b.number - a.number)
            // Fan out one rollup call per series. Failures don't block the
            // whole list — they just leave counts=null and the card shows
            // a neutral state.
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
        <View style={{gap: 12} as any}>
            {items.map(item => (
                <SeriesRow
                    key={item.id}
                    series={item}
                    onOpen={() => navigate(`/homework/series/${item.id}`)}
                />
            ))}
        </View>
    )
}

function SeriesRow({series, onOpen}: {series: SeriesWithCounts; onOpen: () => void}) {
    const overdue = !!series.due_at && new Date(series.due_at).getTime() < Date.now()
    // Overdue psets get a muted look and a compact "X из Y" summary
    // instead of three separate badges. We still surface in-progress
    // count when > 0, because graders may finish grading after the
    // deadline; rejected count is intentionally hidden so an old
    // pset's wall of red doesn't dominate the dashboard.
    return (
        <Pressable
            onPress={onOpen}
            style={({pressed}) => [
                s.card,
                overdue && s.cardOverdue,
                pressed && {backgroundColor: overdue ? '#f3f4f6' : '#f9fafb'},
            ]}
        >
            <View style={s.headerRow}>
                <View style={{flex: 1, minWidth: 0}}>
                    <Heading>{series.display_name}</Heading>
                    <Text style={[s.meta, overdue && s.metaOverdue]}>
                        Срок: {formatDateTime(series.due_at)}
                    </Text>
                </View>
                {series.counts ? (
                    overdue
                        ? <OverdueSummary counts={series.counts}/>
                        : <ProgressBadges counts={series.counts}/>
                ) : null}
            </View>
        </Pressable>
    )
}

// OverdueSummary renders the simplified "X из Y решено" form for closed
// psets. We deliberately omit the rejected count (an old pset's wall of
// red is not actionable) and the "не решена" count (the deadline has
// passed, the student can't do anything about it). What we still show is
// "проверяется" when graders are actively working on something — they
// often finish reviewing after the deadline, so the student should see
// progress moving.
function OverdueSummary({counts}: {counts: GranularCounts}) {
    // "X из Y решена/решены" agrees with the count of solved tasks:
    // 1 из 5 решена, 3 из 5 решены, 0 из 5 решены.
    const solvedWord = ruPlural(counts.accepted, 'решена', 'решены')
    return (
        <View style={s.overdueSummary}>
            <Text style={s.overdueSolved}>
                {counts.accepted}<Text style={s.overdueTotal}> из {counts.total} {solvedWord}</Text>
            </Text>
            {counts.checking > 0 ? (
                <Text style={s.overdueInProgress}>
                    {counts.checking} {ruPlural(counts.checking, 'проверяется', 'проверяются')}
                </Text>
            ) : null}
        </View>
    )
}

const s = StyleSheet.create({
    card: {
        backgroundColor: colors.surface,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.border,
        padding: 18,
    },
    // Overdue: muted bg + dimmed text so the user's eye skips past
    // already-closed psets and focuses on the active ones.
    cardOverdue: {
        backgroundColor: '#f3f4f6',
        borderColor: '#e5e7eb',
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
    } as any,
    meta: {fontSize: 13, color: colors.textMuted, marginTop: 2},
    metaOverdue: {color: '#9ca3af'},
    overdueSummary: {alignItems: 'flex-end'},
    overdueSolved: {fontSize: 16, fontWeight: '700', color: '#374151'},
    overdueTotal: {fontSize: 14, fontWeight: '500', color: '#6b7280'},
    overdueInProgress: {fontSize: 12, color: '#92400e', marginTop: 2, fontWeight: '500'},
})
